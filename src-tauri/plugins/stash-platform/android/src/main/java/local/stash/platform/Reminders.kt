package local.stash.platform

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Pending reminders. Alarms don't survive a restart, so each is also saved here and set again on
 * boot. A snooze is one more pending reminder and needs nothing from the app's process.
 */
internal object Reminders {
    const val EXTRA_TASK = "stash.reminder.task"
    private const val CHANNEL = "task-reminders"
    private const val PREFERENCES = "stash.reminders"
    private const val KEY_PENDING = "pending"
    private const val KEY_ASKED = "asked"
    private const val TASK_PREFIX = "stash.task."
    private const val SNOOZE_PREFIX = "stash.snooze."
    const val ACTION_FIRE = "local.stash.platform.reminder.FIRE"
    const val ACTION_SNOOZE = "local.stash.platform.reminder.SNOOZE"
    const val EXTRA_SECONDS = "seconds"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"

    data class Entry(val id: String, val title: String, val body: String, val fireAt: Long)

    private fun preferences(context: Context) = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private fun load(context: Context): JSONObject =
        JSONObject(preferences(context).getString(KEY_PENDING, null) ?: "{}")
    private fun store(context: Context, pending: JSONObject) {
        preferences(context).edit().putString(KEY_PENDING, pending.toString()).apply()
    }
    private fun read(id: String, value: JSONObject) =
        Entry(id, value.getString("title"), value.getString("body"), value.getLong("fireAt"))
    private fun write(entry: Entry) =
        JSONObject().put("title", entry.title).put("body", entry.body).put("fireAt", entry.fireAt)

    fun markAsked(context: Context) { preferences(context).edit().putBoolean(KEY_ASKED, true).apply() }

    fun status(context: Context): String {
        val manager = NotificationManagerCompat.from(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return if (preferences(context).getBoolean(KEY_ASKED, false)) "denied" else "notDetermined"
        if (!manager.areNotificationsEnabled()) return "denied"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE
        ) return "denied"
        return "granted"
    }

    @Synchronized fun pendingIds(context: Context): List<String> {
        val pending = load(context)
        return pending.keys().asSequence().toList()
    }

    /**
     * Replaces future task reminders and removes the named ones. Snoozes stay, and so does a
     * reminder Android is late delivering, unless named: the app no longer lists past times.
     */
    @Synchronized fun sync(context: Context, entries: List<Entry>, drop: List<String>) {
        val pending = load(context)
        val wanted = entries.map { it.id }.toSet()
        val now = System.currentTimeMillis()
        for (id in pending.keys().asSequence().toList()) {
            val future = pending.getJSONObject(id).getLong("fireAt") > now
            if ((id.startsWith(TASK_PREFIX) && id !in wanted && future) || id in drop) {
                pending.remove(id)
                cancel(context, id)
            }
        }
        for (entry in entries) {
            if (!entry.id.startsWith(TASK_PREFIX)) continue
            pending.put(entry.id, write(entry))
            schedule(context, entry.id, entry.fireAt)
        }
        store(context, pending)
    }

    @Synchronized fun remove(context: Context, ids: List<String>) {
        val pending = load(context)
        for (id in ids) {
            pending.remove(id)
            cancel(context, id)
        }
        store(context, pending)
    }

    @Synchronized fun restore(context: Context) {
        val pending = load(context)
        for (id in pending.keys().asSequence().toList()) schedule(context, id, pending.getJSONObject(id).getLong("fireAt"))
    }

    @Synchronized fun fire(context: Context, id: String) {
        val pending = load(context)
        val value = pending.optJSONObject(id) ?: return
        pending.remove(id)
        store(context, pending)
        show(context, read(id, value))
    }

    @Synchronized fun snooze(context: Context, id: String, title: String, body: String, seconds: Long) {
        NotificationManagerCompat.from(context).cancel(id.hashCode())
        val until = System.currentTimeMillis() + seconds * 1000
        val snooze = Entry(snoozeId(id, until), title, body, until)
        val pending = load(context)
        pending.put(snooze.id, write(snooze))
        store(context, pending)
        schedule(context, snooze.id, until)
    }

    /** `stash.task.<task>.<minutes>.<anchor>` or `stash.snooze.<task>.<anchor>.<until>`. */
    private fun fields(id: String) = id.removePrefix(TASK_PREFIX).removePrefix(SNOOZE_PREFIX).split(".")
    private fun taskId(id: String) = fields(id)[0]
    private fun snoozeId(id: String, until: Long): String {
        val parts = fields(id)
        val anchor = if (id.startsWith(TASK_PREFIX)) parts[2] else parts[1]
        return "$SNOOZE_PREFIX${parts[0]}.$anchor.$until"
    }

    private fun alarm(context: Context, id: String) = PendingIntent.getBroadcast(
        context, 0,
        Intent(context, ReminderReceiver::class.java).setAction(ACTION_FIRE).setData(Uri.parse("stash-reminder:$id")),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    private fun schedule(context: Context, id: String, at: Long) {
        val manager = context.getSystemService(AlarmManager::class.java)
        // If the exact-alarm grant is revoked, Android may deliver a few minutes late.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms())
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm(context, id))
        else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm(context, id))
    }
    private fun cancel(context: Context, id: String) {
        context.getSystemService(AlarmManager::class.java).cancel(alarm(context, id))
    }

    private val snoozes = listOf(600L to "10 min", 3600L to "1 hour", 86400L to "1 day")
    private fun show(context: Context, entry: Entry) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "Task reminders", NotificationManager.IMPORTANCE_HIGH),
            )
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            ?.setData(Uri.parse("stash-reminder:${entry.id}"))
            ?.putExtra(EXTRA_TASK, taskId(entry.id))
        val builder = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stash_reminder)
            .setContentTitle(entry.title)
            .setContentText(entry.body)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
        if (open != null) builder.setContentIntent(
            PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
        )
        for ((seconds, label) in snoozes) {
            val intent = Intent(context, ReminderReceiver::class.java).setAction(ACTION_SNOOZE)
                .setData(Uri.parse("stash-reminder:${entry.id}?seconds=$seconds"))
                .putExtra(EXTRA_SECONDS, seconds).putExtra(EXTRA_TITLE, entry.title).putExtra(EXTRA_BODY, entry.body)
            builder.addAction(0, label, PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
        if (status(context) == "granted") NotificationManagerCompat.from(context).notify(entry.id.hashCode(), builder.build())
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.data?.schemeSpecificPart?.substringBefore('?')
        when (intent.action) {
            Reminders.ACTION_FIRE -> if (id != null) Reminders.fire(context, id)
            Reminders.ACTION_SNOOZE -> if (id != null) Reminders.snooze(
                context, id,
                intent.getStringExtra(Reminders.EXTRA_TITLE) ?: "",
                intent.getStringExtra(Reminders.EXTRA_BODY) ?: "",
                intent.getLongExtra(Reminders.EXTRA_SECONDS, 600),
            )
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> Reminders.restore(context)
        }
    }
}
