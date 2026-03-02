use anyhow::{Result, anyhow};

/// Parse a JSON object from agent CLI output, which may contain markdown code blocks or extra text.
pub fn parse_json_from_agent<T: serde::de::DeserializeOwned>(text: &str) -> Result<T> {
    if let Ok(v) = serde_json::from_str::<T>(text.trim()) {
        return Ok(v);
    }

    if let Some(start) = text.find('{') {
        let mut depth = 0;
        let mut end = start;
        for (i, ch) in text[start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = start + i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        if end > start {
            if let Ok(v) = serde_json::from_str::<T>(&text[start..end]) {
                return Ok(v);
            }
        }
    }

    Err(anyhow!("No valid JSON found in agent response"))
}

/// Truncate a string to a max byte length, returning the original if shorter.
pub fn truncate(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((byte_idx, _)) => &s[..byte_idx],
        None => s,
    }
}
