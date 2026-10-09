use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde_json::Value;

fn valid(text: &str, tag: &str) -> bool {
    text.strip_prefix('#').is_some_and(|name| {
        !name.is_empty()
            && !name.starts_with('#')
            && !name.chars().any(char::is_whitespace)
            && !name.ends_with(super::terminal_tag_punctuation)
            && name.to_lowercase() == tag
    })
}
fn push(result: &mut Vec<String>, text: &str, tag: &str) {
    if valid(text, tag) && !result.iter().any(|value| value == tag) {
        result.push(tag.to_owned());
    }
}
pub(super) fn document_tags(doc: &Value) -> Vec<String> {
    fn visit(node: &Value, result: &mut Vec<String>) {
        let Some(children) = node["content"].as_array() else {
            return;
        };
        let mut tag = "";
        let mut text = String::new();
        for child in children {
            let next = if child["type"] == "text" {
                child["marks"]
                    .as_array()
                    .and_then(|marks| marks.iter().find(|mark| mark["type"] == "bodyTag"))
                    .and_then(|mark| mark["attrs"]["tag"].as_str())
                    .unwrap_or("")
            } else {
                ""
            };
            if next.is_empty() || next != tag {
                push(result, &text, tag);
                text.clear();
            }
            tag = next;
            if !next.is_empty() {
                text.push_str(child["text"].as_str().unwrap_or(""));
            } else {
                visit(child, result);
            }
        }
        push(result, &text, tag);
    }
    let mut result = Vec::new();
    visit(doc, &mut result);
    result
}

// Read only our explicit inline marker. Markers inside code, raw HTML blocks,
// and plain #text cannot contribute tags. pulldown decodes HTML entities in the visible text.
pub(super) fn markdown_tags(markdown: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current: Option<(String, String)> = None;
    let mut code = false;
    for event in Parser::new_ext(
        markdown,
        Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS,
    ) {
        match event {
            Event::Start(Tag::CodeBlock(_)) => {
                code = true;
                current = None;
            }
            Event::End(TagEnd::CodeBlock) => {
                code = false;
            }
            Event::InlineHtml(html) if !code => {
                if html.as_ref() == "</span>" {
                    if let Some((tag, text)) = current.take() {
                        push(&mut result, &text, &tag);
                    }
                } else {
                    current = html
                        .strip_prefix("<span data-confirmed-tag=\"")
                        .and_then(|value| value.strip_suffix("\">"))
                        .and_then(|value| {
                            percent_encoding::percent_decode_str(value)
                                .decode_utf8()
                                .ok()
                        })
                        .map(|tag| (tag.into_owned(), String::new()));
                }
            }
            Event::Text(text) | Event::Code(text) if !code => {
                if let Some((_, value)) = current.as_mut() {
                    value.push_str(&text);
                }
            }
            Event::Start(Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::Link { .. })
            | Event::End(
                TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Link,
            ) => {}
            _ => {
                current = None;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_complete_confirmed_runs_are_indexed() {
        let doc = json!({"type":"doc","content":[{"type":"paragraph","content":[
            {"type":"text","text":"#abcdef #plain "},
            {"type":"text","text":"#Tu","marks":[{"type":"bodyTag","attrs":{"tag":"tutorial"}}]},
            {"type":"text","text":"torial","marks":[{"type":"bold"},{"type":"bodyTag","attrs":{"tag":"tutorial"}}]},
            {"type":"text","text":" "},
            {"type":"text","text":"partial","marks":[{"type":"bodyTag","attrs":{"tag":"partial"}}]}
        ]}]});
        assert_eq!(document_tags(&doc), vec!["tutorial"]);
    }
    #[test]
    fn markdown_requires_markers_and_ignores_code_and_invalid_spans() {
        let span = "<span data-confirmed-tag=\"tutorial\">#Tutorial</span>";
        assert_eq!(
            markdown_tags(&format!("{span} #abcdef #plain")),
            vec!["tutorial"]
        );
        assert!(markdown_tags(&format!("`{span}`\n\n```html\n{span}\n```\n")).is_empty());
        assert!(markdown_tags("<span data-confirmed-tag=\"tutorial\">partial</span>").is_empty());
        assert_eq!(
            markdown_tags("<span data-confirmed-tag=\"a%26b\">#a&amp;b</span>"),
            vec!["a&b"]
        );
        assert_eq!(
            markdown_tags("<span data-confirmed-tag=\"two_words\">#two\\_words</span>"),
            vec!["two_words"]
        );
        for inner in [
            "~~#tutorial~~",
            "`#tutorial`",
            "[#tutorial](https://example.com)",
        ] {
            assert_eq!(
                markdown_tags(&format!(
                    "<span data-confirmed-tag=\"tutorial\">{inner}</span>"
                )),
                vec!["tutorial"]
            );
        }
        assert_eq!(
            markdown_tags("<span data-confirmed-tag=\"tutorial\">#**tut**orial</span>"),
            vec!["tutorial"]
        );
    }
}
