//! Local-only dictation. The worker owns microphone streams and Whisper contexts.
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};

const REVISION: &str = "5359861c739e955e79d9a303bcbc70fb988958b1";
struct Model {
    id: &'static str,
    bytes: u64,
    hash: &'static str,
}
const MODELS: [Model; 2] = [
    Model {
        id: "small",
        bytes: 487601967,
        hash: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    },
    Model {
        id: "base",
        bytes: 147951465,
        hash: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    },
];
fn model(id: &str) -> Result<&'static Model, String> {
    MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or("Unknown dictation model".into())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    session_id: String,
    phase: String,
    seconds: u32,
    downloaded: u64,
    total: u64,
    transcript: Option<String>,
    error: Option<String>,
}
impl Default for Progress {
    fn default() -> Self {
        Self {
            session_id: String::new(),
            phase: "idle".into(),
            seconds: 0,
            downloaded: 0,
            total: 0,
            transcript: None,
            error: None,
        }
    }
}
/// Loudness only, for the waveform. Audio samples never cross the frontend bridge.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Level {
    session_id: String,
    level: f32,
}
struct Job {
    id: String,
    cancel: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
}
#[derive(Default)]
pub struct Service {
    job: Mutex<Option<Job>>,
    progress: Mutex<Progress>,
}
#[derive(Serialize)]
pub struct ModelStatus {
    id: &'static str,
    bytes: u64,
    installed: bool,
}
#[derive(Serialize)]
pub struct Status {
    supported: bool,
    models: Vec<ModelStatus>,
    progress: Progress,
}
fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    #[cfg(debug_assertions)]
    let dir = std::env::var_os("UPNOTE2_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(dir);
    Ok(dir.join("dictation-models"))
}
fn path(app: &tauri::AppHandle, m: &Model) -> Result<PathBuf, String> {
    Ok(directory(app)?.join(format!("ggml-{}.bin", m.id)))
}
fn installed(app: &tauri::AppHandle, m: &Model) -> bool {
    path(app, m)
        .ok()
        .and_then(|p| p.metadata().ok())
        .is_some_and(|s| s.len() == m.bytes)
}
fn publish(app: &tauri::AppHandle, id: &str, update: impl FnOnce(&mut Progress)) {
    let service = app.state::<Service>();
    let mut p = service.progress.lock().unwrap();
    if p.session_id != id {
        return;
    }
    update(&mut p);
    let _ = app.emit("dictation-progress", p.clone());
}
fn finish(app: &tauri::AppHandle, id: &str, result: Result<Option<String>, String>) {
    // Keep the job reserved until the worker has dropped its audio/model resources.
    let service = app.state::<Service>();
    let mut job = service.job.lock().unwrap();
    let Some(current) = job.as_ref().filter(|job| job.id == id) else {
        return;
    };
    let cancelled = current.cancel.load(Ordering::Relaxed);
    publish(app, id, |p| {
        if cancelled {
            p.phase = "cancelled".into();
            p.transcript = None;
        } else {
            match result {
                Ok(text) => {
                    p.phase = if text.is_some() { "review" } else { "idle" }.into();
                    p.transcript = text;
                }
                Err(e) => {
                    p.phase = "error".into();
                    p.error = Some(e);
                }
            }
        }
    });
    *job = None;
}
fn reserve(
    app: &tauri::AppHandle,
    id: String,
    phase: &str,
) -> Result<(Arc<AtomicBool>, Arc<AtomicBool>), String> {
    if !cfg!(target_os = "macos") {
        return Err("Dictation is available in the macOS app.".into());
    }
    app.state::<Service>().begin(id, phase)
}
impl Service {
    fn begin(&self, id: String, phase: &str) -> Result<(Arc<AtomicBool>, Arc<AtomicBool>), String> {
        if id.is_empty() || id.len() > 80 {
            return Err("Invalid dictation session".into());
        }
        let mut job = self.job.lock().unwrap();
        if job.is_some() {
            return Err("Wait for the current dictation operation to finish.".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(false));
        *self.progress.lock().unwrap() = Progress {
            session_id: id.clone(),
            phase: phase.into(),
            ..Progress::default()
        };
        *job = Some(Job {
            id,
            cancel: cancel.clone(),
            stop: stop.clone(),
        });
        Ok((cancel, stop))
    }
    fn interrupt(&self, id: &str, stop: bool) {
        let job = self.job.lock().unwrap();
        if let Some(j) = job.as_ref().filter(|j| j.id == id) {
            if stop {
                j.stop.store(true, Ordering::Relaxed);
            } else {
                j.cancel.store(true, Ordering::Relaxed);
            }
        }
        if !stop && job.is_none() {
            let mut p = self.progress.lock().unwrap();
            if p.session_id == id {
                *p = Progress::default();
            }
        }
    }
}

#[tauri::command]
pub fn dictation_status(app: tauri::AppHandle, service: tauri::State<Service>) -> Status {
    Status {
        supported: cfg!(target_os = "macos"),
        models: MODELS
            .iter()
            .map(|m| ModelStatus {
                id: m.id,
                bytes: m.bytes,
                installed: installed(&app, m),
            })
            .collect(),
        progress: service.progress.lock().unwrap().clone(),
    }
}
#[tauri::command]
pub fn dictation_cancel(service: tauri::State<Service>, session_id: String) {
    service.interrupt(&session_id, false);
}
#[tauri::command]
pub fn dictation_stop(service: tauri::State<Service>, session_id: String) {
    service.interrupt(&session_id, true);
}

#[tauri::command]
pub fn dictation_delete_model(
    app: tauri::AppHandle,
    service: tauri::State<Service>,
    model_id: String,
) -> Result<(), String> {
    let _guard = service.job.lock().unwrap();
    if _guard.is_some() {
        return Err("Wait for dictation to finish before removing a model.".into());
    }
    let p = path(&app, model(&model_id)?)?;
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn dictation_download(
    app: tauri::AppHandle,
    session_id: String,
    model_id: String,
) -> Result<(), String> {
    let m = model(&model_id)?;
    let (cancel, _) = reserve(&app, session_id.clone(), "downloading")?;
    publish(&app, &session_id, |p| p.total = m.bytes);
    std::thread::spawn(move || {
        let result = download(&app, &session_id, m, &cancel).map(|_| None);
        finish(&app, &session_id, result);
    });
    Ok(())
}
fn download(
    app: &tauri::AppHandle,
    id: &str,
    m: &Model,
    cancel: &AtomicBool,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    let dir = directory(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = path(app, m)?;
    let partial = target.with_extension("part");
    let result = tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(1800))
            .build()
            .map_err(|e| e.to_string())?;
        let request = client
            .get(format!(
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/{REVISION}/ggml-{}.bin",
                m.id
            ))
            .send();
        let mut response = cancellable(request, cancel)
            .await?
            .error_for_status()
            .map_err(|e| format!("Model download failed: {e}"))?;
        let mut file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut total = 0u64;
        let mut last = std::time::Instant::now();
        publish(app, id, |p| p.total = m.bytes);
        while let Some(bytes) = cancellable(response.chunk(), cancel).await? {
            total += bytes.len() as u64;
            if total > m.bytes {
                return Err("Model download exceeded its expected size.".into());
            }
            hash.update(&bytes);
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            if last.elapsed() >= Duration::from_millis(200) {
                publish(app, id, |p| p.downloaded = total);
                last = std::time::Instant::now();
            }
        }
        verify_model(m, total, &format!("{:x}", hash.finalize()))?;
        if cancel.load(Ordering::Relaxed) {
            return Err("Download cancelled".into());
        }
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        std::fs::rename(&partial, &target).map_err(|e| e.to_string())?;
        publish(app, id, |p| p.downloaded = total);
        Ok(())
    });
    if result.is_err() {
        let _ = std::fs::remove_file(partial);
    }
    result
}
async fn cancellable<T>(
    future: impl std::future::Future<Output = Result<T, reqwest::Error>>,
    cancel: &AtomicBool,
) -> Result<T, String> {
    tokio::pin!(future);
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Download cancelled".into());
        }
        tokio::select! {
            result = &mut future => return result.map_err(|e| format!("Model download interrupted: {e}")),
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
    }
}

#[cfg(any(target_os = "macos", test))]
fn verify_local_model(
    path: &std::path::Path,
    m: &Model,
    cancel: &AtomicBool,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path)
        .map_err(|_| "Could not open the speech model. Download it again.")?;
    let mut hash = Sha256::new();
    let mut total = 0;
    let mut buffer = [0u8; 65536];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        let n = file
            .read(&mut buffer)
            .map_err(|_| "Could not read the speech model.")?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > m.bytes {
            return Err("Model verification failed. Please download it again.".into());
        }
        hash.update(&buffer[..n]);
    }
    verify_model(m, total, &format!("{:x}", hash.finalize()))
}
fn verify_model(m: &Model, size: u64, hash: &str) -> Result<(), String> {
    if size != m.bytes || hash != m.hash {
        Err("Model verification failed. Please download it again.".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub fn dictation_start(
    app: tauri::AppHandle,
    session_id: String,
    model_id: String,
    language: String,
) -> Result<(), String> {
    let m = model(&model_id)?;
    if !["auto", "en", "id"].contains(&language.as_str()) {
        return Err("Unsupported dictation language".into());
    }
    if !installed(&app, m) {
        return Err("Download the selected model first.".into());
    }
    let model_path = path(&app, m)?;
    let (cancel, stop) = reserve(&app, session_id.clone(), "preparing")?;
    std::thread::spawn(move || {
        #[cfg(target_os = "macos")]
        let result = verify_local_model(&model_path, m, &cancel)
            .and_then(|_| {
                native::record_and_transcribe(
                    &app,
                    &session_id,
                    model_path,
                    &language,
                    cancel.clone(),
                    stop,
                )
            })
            .map(Some);
        #[cfg(not(target_os = "macos"))]
        let result = {
            let _ = (model_path, language, stop, cancel);
            Err("Dictation requires macOS".into())
        };
        finish(&app, &session_id, result);
    });
    Ok(())
}
#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use rubato::{FftFixedInOut, Resampler};
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
    const MAX_SECONDS: usize = 300;
    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        static AVMediaTypeAudio: &'static objc2_foundation::NSString;
    }
    fn microphone_permission(cancel: &AtomicBool) -> Result<(), String> {
        use objc2::{
            msg_send,
            runtime::{AnyClass, Bool},
        };
        let class =
            AnyClass::get(c"AVCaptureDevice").ok_or("Microphone permission service unavailable")?;
        // AVFoundation documents these class methods as thread-safe. The framework owns
        // AVMediaTypeAudio; it copies the completion block until authorization completes.
        let status: isize =
            unsafe { msg_send![class, authorizationStatusForMediaType: AVMediaTypeAudio] };
        if status == 3 {
            return Ok(());
        }
        if status != 0 {
            return Err(microphone_error("permission denied"));
        }
        let (sender, receiver) = std::sync::mpsc::channel();
        let callback = block2::RcBlock::new(move |granted: Bool| {
            let _ = sender.send(granted.as_bool());
        });
        unsafe {
            let _: () = msg_send![class, requestAccessForMediaType: AVMediaTypeAudio, completionHandler: &*callback];
        }
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err("Cancelled".into());
            }
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(true) => return Ok(()),
                Ok(false) => return Err(microphone_error("permission denied")),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => return Err(microphone_error("permission request failed")),
            }
        }
    }
    fn microphone_error(error: impl std::fmt::Display) -> String {
        format!("Microphone unavailable: {error}. Check System Settings > Privacy & Security > Microphone and your sound input device.")
    }
    pub fn record_and_transcribe(
        app: &tauri::AppHandle,
        id: &str,
        path: PathBuf,
        language: &str,
        cancel: Arc<AtomicBool>,
        stop: Arc<AtomicBool>,
    ) -> Result<String, String> {
        microphone_permission(&cancel)?;
        let device = cpal::default_host()
            .default_input_device()
            .ok_or("No microphone found. Connect an input device and try again.")?;
        let supported = device.default_input_config().map_err(microphone_error)?;
        let rate = supported.sample_rate().0 as usize;
        let channels = supported.channels() as usize;
        if !(8000..=192000).contains(&rate) || channels == 0 || channels > 32 {
            return Err("Unsupported microphone format.".into());
        }
        let audio = Arc::new(Mutex::new(Vec::<f32>::with_capacity(rate * MAX_SECONDS)));
        let failure = Arc::new(Mutex::new(None::<String>));
        // Loudest buffer since the last publish, as f32 bits (they order like non-negative floats).
        let level = Arc::new(AtomicU32::new(0));
        let config = supported.config();
        macro_rules! stream {
            ($sample:ty) => {{
                let audio = audio.clone();
                let failure = failure.clone();
                let level = level.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[$sample], _| {
                        let mut samples = audio.lock().unwrap();
                        let remaining = (rate * MAX_SECONDS).saturating_sub(samples.len());
                        let before = samples.len();
                        samples.extend(data.chunks_exact(channels).take(remaining).map(|frame| {
                            frame
                                .iter()
                                .map(|v| cpal::Sample::to_sample::<f32>(*v))
                                .sum::<f32>()
                                / channels as f32
                        }));
                        let added = &samples[before..];
                        if !added.is_empty() {
                            let power = added.iter().map(|v| v * v).sum::<f32>();
                            let rms = (power / added.len() as f32).sqrt();
                            level.fetch_max(rms.to_bits(), Ordering::Relaxed);
                        }
                    },
                    move |e| {
                        *failure.lock().unwrap() = Some(microphone_error(e));
                    },
                    None,
                )
            }};
        }
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => stream!(f32),
            cpal::SampleFormat::I16 => stream!(i16),
            cpal::SampleFormat::U16 => stream!(u16),
            cpal::SampleFormat::I32 => stream!(i32),
            _ => return Err("Unsupported microphone sample format.".into()),
        }
        .map_err(microphone_error)?;
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        stream.play().map_err(microphone_error)?;
        publish(app, id, |p| p.phase = "recording".into());
        let started = std::time::Instant::now();
        let mut last_second = 0;
        while !stop.load(Ordering::Relaxed)
            && !cancel.load(Ordering::Relaxed)
            && started.elapsed().as_secs() < MAX_SECONDS as u64
        {
            if let Some(e) = failure.lock().unwrap().take() {
                return Err(e);
            }
            let second = started.elapsed().as_secs() as u32;
            if second != last_second {
                publish(app, id, |p| p.seconds = second);
                last_second = second;
            }
            let _ = app.emit(
                "dictation-level",
                Level {
                    session_id: id.to_string(),
                    level: f32::from_bits(level.swap(0, Ordering::Relaxed)),
                },
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        drop(stream);
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        let samples = std::mem::take(&mut *audio.lock().unwrap());
        if samples.len() < rate / 4
            || samples.iter().fold(0f32, |peak, v| peak.max(v.abs())) < 0.001
        {
            return Err("No speech detected. Try again closer to the microphone.".into());
        }
        publish(app, id, |p| p.phase = "transcribing".into());
        let pcm = resample(&samples, rate)?;
        drop(samples);
        transcribe(&pcm, &path, language, cancel)
    }
    fn transcribe(
        pcm: &[f32],
        path: &std::path::Path,
        language: &str,
        cancel: Arc<AtomicBool>,
    ) -> Result<String, String> {
        // Native debug logs can include decoded tokens. No log backend is enabled,
        // so these hooks discard Whisper/GGML logs rather than leaking note text.
        whisper_rs::install_logging_hooks();
        let context = WhisperContext::new_with_params(
            path.to_str().ok_or("Invalid model path")?,
            WhisperContextParameters::default(),
        )
        .map_err(|_| {
            "Could not load the speech model. Remove it in Settings and download it again."
        })?;
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        let mut state = context.create_state().map_err(|e| e.to_string())?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(if language == "auto" {
            None
        } else {
            Some(language)
        });
        params.set_translate(false);
        params.set_no_context(true);
        params.set_no_timestamps(true);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_print_special(false);
        params.set_n_threads(2);
        params.set_no_speech_thold(0.6);
        // The Arc stays alive until synchronous full() returns; Whisper only reads the atomic.
        unsafe extern "C" fn abort(data: *mut std::ffi::c_void) -> bool {
            unsafe { &*(data as *const AtomicBool) }.load(Ordering::Relaxed)
        }
        unsafe {
            params.set_abort_callback(Some(abort));
            params.set_abort_callback_user_data(Arc::as_ptr(&cancel) as *mut std::ffi::c_void);
        }
        state
            .full(params, pcm)
            .map_err(|_| "Transcription failed. Try recording again.".to_string())?;
        let segments = state
            .as_iter()
            .map(|segment| segment.to_str_lossy().map(|s| s.into_owned()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Could not read the transcript. Try recording again.")?;
        let text = segments.join("").trim().to_string();
        if text.is_empty() {
            return Err("No speech detected. Try again.".into());
        }
        Ok(text)
    }
    pub(super) fn resample(samples: &[f32], rate: usize) -> Result<Vec<f32>, String> {
        if rate == 16000 {
            return Ok(samples.to_vec());
        }
        let mut resampler =
            FftFixedInOut::<f32>::new(rate, 16000, 1024, 1).map_err(|e| e.to_string())?;
        let chunk = resampler.input_frames_next();
        let delay = resampler.output_delay();
        let needed = samples.len() * 16000 / rate;
        let mut output = Vec::new();
        for frame in samples.chunks(chunk) {
            let mut padded = vec![0f32; chunk];
            padded[..frame.len()].copy_from_slice(frame);
            let result = resampler
                .process(&[padded], None)
                .map_err(|e| e.to_string())?;
            output.extend_from_slice(&result[0]);
        }
        while output.len() < needed + delay {
            let result = resampler
                .process(&[vec![0f32; chunk]], None)
                .map_err(|e| e.to_string())?;
            output.extend_from_slice(&result[0]);
        }
        Ok(output[delay..delay + needed].to_vec())
    }
    #[test]
    #[ignore = "requires a downloaded model and a synthetic 16 kHz mono f32le fixture"]
    fn transcribe_fixture() {
        let model = std::env::var("STASH_DICTATION_TEST_MODEL").unwrap();
        let audio = std::fs::read(std::env::var("STASH_DICTATION_TEST_AUDIO").unwrap()).unwrap();
        let pcm = audio
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect::<Vec<_>>();
        let language = std::env::var("STASH_DICTATION_TEST_LANGUAGE").unwrap_or("auto".into());
        let started = std::time::Instant::now();
        let text = transcribe(
            &pcm,
            std::path::Path::new(&model),
            &language,
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        println!(
            "Synthetic fixture: {text} ({:.2}s for {:.2}s audio)",
            started.elapsed().as_secs_f32(),
            pcm.len() as f64 / 16000.
        );
        if let Ok(expected) = std::env::var("STASH_DICTATION_TEST_EXPECT") {
            assert!(
                text.to_lowercase().contains(&expected.to_lowercase()),
                "Unexpected fixture transcript"
            );
        }
    }
    #[test]
    fn conversion_preserves_duration() {
        for rate in [44100, 48000, 16000] {
            let data = vec![0.1; rate];
            let out = resample(&data, rate).unwrap();
            assert_eq!(out.len(), 16000);
            assert!((out[8000] - 0.1).abs() < 0.01);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_corrupt_model_and_cancelled_verification() {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), b"not a model").unwrap();
        assert!(verify_local_model(file.path(), &MODELS[0], &AtomicBool::new(false)).is_err());
        assert_eq!(
            verify_local_model(file.path(), &MODELS[0], &AtomicBool::new(true)).unwrap_err(),
            "Cancelled"
        );
    }
    #[test]
    fn single_job_and_session_scoped_cancellation() {
        let service = Service::default();
        let (cancel, stop) = service.begin("one".into(), "recording").unwrap();
        assert!(service.begin("two".into(), "recording").is_err());
        service.interrupt("old", false);
        service.interrupt("old", true);
        assert!(!cancel.load(Ordering::Relaxed));
        assert!(!stop.load(Ordering::Relaxed));
        service.interrupt("one", true);
        assert!(stop.load(Ordering::Relaxed));
        assert!(!cancel.load(Ordering::Relaxed));
        service.interrupt("one", false);
        assert!(cancel.load(Ordering::Relaxed));
        // Cancellation does not release ownership until the worker has exited.
        assert!(service.begin("two".into(), "recording").is_err());
        *service.job.lock().unwrap() = None;
        service.progress.lock().unwrap().transcript = Some("private text".into());
        service.interrupt("old", false);
        assert!(service.progress.lock().unwrap().transcript.is_some());
        service.interrupt("one", false);
        assert!(service.progress.lock().unwrap().transcript.is_none());
    }
    #[test]
    fn cancel_stalled_network_future() {
        let cancel = Arc::new(AtomicBool::new(false));
        let c = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            c.store(true, Ordering::Relaxed);
        });
        let result = tauri::async_runtime::block_on(cancellable(
            std::future::pending::<Result<(), reqwest::Error>>(),
            &cancel,
        ));
        assert_eq!(result.unwrap_err(), "Download cancelled");
    }
    #[test]
    fn model_integrity_and_allowlist() {
        assert!(model("base.en").is_err());
        for m in &MODELS {
            assert!(verify_model(m, m.bytes, m.hash).is_ok());
            assert!(verify_model(m, m.bytes - 1, m.hash).is_err());
            assert!(verify_model(m, m.bytes, "bad").is_err());
        }
    }
}

/// Closing the app must never leave a microphone or download worker running.
#[cfg(desktop)]
pub fn cancel_all(service: &Service) {
    if let Some(job) = service.job.lock().unwrap().as_ref() {
        job.cancel.store(true, Ordering::Relaxed);
    }
}
