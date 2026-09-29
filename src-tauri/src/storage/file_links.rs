//! Edit only Markdown destination spans, leaving surrounding source untouched.
use super::file_io::{self, Change};
use super::linked::{scoped, FileRecord};
use super::*;
use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};
use std::ops::Range;

fn destination(text: &str, start: usize) -> Option<Range<usize>> {
    let bytes = text.as_bytes();
    let mut i = start;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if bytes.get(i) == Some(&b'<') {
        let begin = i + 1;
        return text[begin..].find('>').map(|n| begin..begin + n);
    }
    let begin = i;
    let mut depth = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => {
                i += 2;
                continue;
            }
            b'(' => depth += 1,
            b')' => {
                if depth == 0 {
                    break;
                }
                depth -= 1;
            }
            c if c.is_ascii_whitespace() && depth == 0 => break,
            _ => (),
        };
        i += 1;
    }
    Some(begin..i)
}
pub fn rewrite(text: &str, mut replace: impl FnMut(&str) -> Result<String>) -> Result<String> {
    let parser = Parser::new_ext(text, Options::all());
    let mut ranges = vec![];
    for (_, def) in parser.reference_definitions().iter() {
        let raw = &text[def.span.clone()];
        if let Some(pos) = raw.find("]:") {
            if let Some(r) = destination(raw, pos + 2) {
                ranges.push(def.span.start + r.start..def.span.start + r.end);
            }
        }
    }
    for (event, range) in parser.into_offset_iter() {
        if matches!(
            event,
            Event::Start(
                Tag::Link {
                    link_type: LinkType::Inline,
                    ..
                } | Tag::Image {
                    link_type: LinkType::Inline,
                    ..
                }
            )
        ) {
            let raw = &text[range.clone()];
            // Find the label's closing bracket, allowing nested labels and escaped brackets.
            let b = raw.as_bytes();
            let mut depth = 0;
            let mut i = if b.first() == Some(&b'!') { 1 } else { 0 };
            while i < b.len() {
                if b[i] == b'\\' {
                    i += 2;
                    continue;
                }
                if b[i] == b'[' {
                    depth += 1;
                }
                if b[i] == b']' {
                    depth -= 1;
                    if depth == 0 && b.get(i + 1) == Some(&b'(') {
                        if let Some(r) = destination(raw, i + 2) {
                            ranges.push(range.start + r.start..range.start + r.end);
                        }
                        break;
                    }
                }
                i += 1;
            }
        }
    }
    ranges.sort_by_key(|r| r.start);
    ranges.dedup();
    let mut output = text.to_string();
    for range in ranges.into_iter().rev() {
        let original = &text[range.clone()];
        let next = replace(original)?;
        output.replace_range(range, &next);
    }
    Ok(output)
}
fn decode(href: &str) -> Option<(String, String)> {
    if href.is_empty() || href.starts_with('#') || href.starts_with('/') || href.contains(":") {
        return None;
    }
    let split = href.find(['#', '?']).unwrap_or(href.len());
    let path = percent_encoding::percent_decode_str(&href[..split])
        .decode_utf8()
        .ok()?
        .replace("\\(", "(")
        .replace("\\)", ")")
        .replace("\\ ", " ");
    Some((path, href[split..].into()))
}
fn encode(path: &Path) -> String {
    const ESC: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
        .add(b' ')
        .add(b'#')
        .add(b'?')
        .add(b'%')
        .add(b'(')
        .add(b')')
        .add(b'<')
        .add(b'>')
        .add(b'"')
        .add(b'\\');
    percent_encoding::utf8_percent_encode(&path.to_string_lossy(), ESC).to_string()
}
fn absolute_from(base: &Path, relative: &str) -> Option<PathBuf> {
    let mut path = base.to_path_buf();
    for c in Path::new(relative).components() {
        match c {
            std::path::Component::ParentDir => {
                path.pop();
            }
            std::path::Component::CurDir => (),
            std::path::Component::Normal(s) => path.push(s),
            _ => return None,
        }
    }
    Some(path)
}
impl Store {
    pub fn link_changes(
        &self,
        old: &Path,
        new: &Path,
        text: &str,
        op: &str,
    ) -> Result<(String, Vec<Change>, Vec<FileRecord>)> {
        let roots = self.roots()?;
        let source = roots
            .iter()
            .find(|r| old.starts_with(&r.path))
            .ok_or("Source root not found")?;
        let target = roots
            .iter()
            .find(|r| new.starts_with(&r.path))
            .ok_or("Destination root not found")?;
        let mut changes = vec![];
        let mut records = vec![];
        let result = rewrite(text, |href| {
            let Some((relative, suffix)) = decode(href) else {
                return Ok(href.into());
            };
            let Some(mut resolved) = absolute_from(old.parent().unwrap(), &relative) else {
                return Ok(href.into());
            };
            if resolved == old {
                resolved = new.to_path_buf();
            }
            if source.id != target.id
                && resolved.starts_with(&source.path)
                && resolved.is_file()
                && resolved
                    .extension()
                    .is_none_or(|e| !e.eq_ignore_ascii_case("md"))
            {
                let relative = resolved
                    .strip_prefix(&source.path)
                    .map_err(db_err)?
                    .to_string_lossy();
                let safe = scoped(Path::new(&source.path), &relative)?;
                let bytes = file_io::read(&safe)?;
                let assets = new.parent().unwrap().join("assets");
                let assets = scoped(
                    Path::new(&target.path),
                    &assets
                        .strip_prefix(&target.path)
                        .map_err(db_err)?
                        .to_string_lossy(),
                )?;
                // Directory creation is idempotent. No existing asset is replaced.
                fs::create_dir_all(&assets).map_err(db_err)?;
                let copied = assets.join(format!(
                    "{}-{}",
                    file_io::hash(&bytes),
                    resolved.file_name().unwrap_or_default().to_string_lossy()
                ));
                if copied.exists() && file_io::read(&copied)? != bytes {
                    return Err("An existing destination asset has different contents. The move was not applied.".into());
                }
                if !copied.exists() && !changes.iter().any(|c: &Change| c.path == copied) {
                    changes.push(Change::new(copied.clone(), None, Some(bytes), op));
                }
                resolved = copied;
            }
            Ok(format!(
                "{}{suffix}",
                encode(
                    &pathdiff::diff_paths(resolved, new.parent().unwrap())
                        .ok_or("Cannot make a relative link")?
                )
            ))
        })?;
        fn markdown_files(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) -> Result<()> {
            if depth > 128 {
                return Err("The folder tree is too deeply nested.".into());
            }
            for entry in fs::read_dir(dir).map_err(db_err)? {
                let entry = entry.map_err(db_err)?;
                let ty = entry.file_type().map_err(db_err)?;
                if ty.is_symlink() || entry.file_name() == ".git" {
                    continue;
                }
                if ty.is_dir() {
                    markdown_files(&entry.path(), out, depth + 1)?;
                } else if ty.is_file()
                    && entry
                        .path()
                        .extension()
                        .is_some_and(|e| e.eq_ignore_ascii_case("md"))
                {
                    out.push(entry.path());
                }
            }
            Ok(())
        }
        for root in roots
            .iter()
            .filter(|r| r.id == source.id || r.id == target.id)
        {
            let mut files = vec![];
            markdown_files(Path::new(&root.path), &mut files, 0)?;
            for path in files {
                if path == old || path == new {
                    continue;
                }
                let bytes = file_io::read(&path)?;
                let markdown = String::from_utf8(bytes.clone()).map_err(db_err)?;
                let rewritten = rewrite(&markdown, |href| {
                    let Some((relative, suffix)) = decode(href) else {
                        return Ok(href.into());
                    };
                    if absolute_from(path.parent().unwrap(), &relative).as_deref() != Some(old) {
                        return Ok(href.into());
                    }
                    Ok(format!(
                        "{}{suffix}",
                        encode(
                            &pathdiff::diff_paths(new, path.parent().unwrap())
                                .ok_or("Cannot make a relative link")?
                        )
                    ))
                })?;
                if rewritten != markdown {
                    changes.push(Change::new(
                        path.clone(),
                        Some(bytes),
                        Some(rewritten.as_bytes().to_vec()),
                        op,
                    ));
                    let rel = path
                        .strip_prefix(&root.path)
                        .map_err(db_err)?
                        .to_string_lossy()
                        .into_owned();
                    let id:Option<String>=self.conn.query_row("SELECT note_id FROM linked_notes WHERE root_id=? AND relative_path=? AND trash_path IS NULL",params![root.id,rel],|r|r.get(0)).optional().map_err(db_err)?;
                    if let Some(id) = id {
                        records.push(FileRecord {
                            note_id: id,
                            root_id: root.id.clone(),
                            relative_path: rel,
                            fingerprint: file_io::hash(rewritten.as_bytes()),
                            markdown: rewritten,
                            trash_path: None,
                        });
                    }
                }
            }
        }
        Ok((result, changes, records))
    }
}
