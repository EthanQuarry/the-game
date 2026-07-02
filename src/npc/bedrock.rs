use std::collections::HashMap;
use std::time::Duration;
use chrono::Utc;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use super::types::LlmResponse;

pub struct AwsCreds {
    pub access_key: String,
    pub secret_key: String,
    pub region: String,
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC key");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    hex::encode(h.finalize())
}

pub fn sigv4_headers(
    creds: &AwsCreds,
    method: &str,
    host: &str,
    path: &str,
    body: &[u8],
) -> HashMap<String, String> {
    let now = Utc::now();
    let date_str = now.format("%Y%m%d").to_string();
    let datetime_str = now.format("%Y%m%dT%H%M%SZ").to_string();
    let service = "bedrock";
    let payload_hash = sha256_hex(body);

    let canonical_headers = format!(
        "content-type:application/json\nhost:{}\nx-amz-content-sha256:{}\nx-amz-date:{}\n",
        host, payload_hash, datetime_str
    );
    let signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date";
    let canonical_uri: String = path.chars().map(|c| match c {
        'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' | '/' => c.to_string(),
        _ => format!("%{:02X}", c as u8),
    }).collect();
    let canonical_request = format!(
        "{}\n{}\n\n{}\n{}\n{}", method, canonical_uri, canonical_headers, signed_headers, payload_hash
    );
    let credential_scope = format!("{}/{}/{}/aws4_request", date_str, creds.region, service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        datetime_str, credential_scope, sha256_hex(canonical_request.as_bytes())
    );
    let signing_key = {
        let k_date = hmac_sha256(format!("AWS4{}", creds.secret_key).as_bytes(), date_str.as_bytes());
        let k_region = hmac_sha256(&k_date, creds.region.as_bytes());
        let k_service = hmac_sha256(&k_region, service.as_bytes());
        hmac_sha256(&k_service, b"aws4_request")
    };
    let signature = hex::encode(hmac_sha256(&signing_key, string_to_sign.as_bytes()));
    let auth = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        creds.access_key, credential_scope, signed_headers, signature
    );

    let mut headers = HashMap::new();
    headers.insert("Authorization".to_string(), auth);
    headers.insert("x-amz-date".to_string(), datetime_str);
    headers.insert("x-amz-content-sha256".to_string(), payload_hash);
    headers.insert("content-type".to_string(), "application/json".to_string());
    headers
}

fn extract_first_json(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escape = false;
    for (i, &b) in text.as_bytes()[start..].iter().enumerate() {
        if escape { escape = false; continue; }
        match b {
            b'\\' if in_string => { escape = true; }
            b'"' => { in_string = !in_string; }
            b'{' if !in_string => { depth += 1; }
            b'}' if !in_string => {
                depth -= 1;
                if depth == 0 { return Some(&text[start..=start+i]); }
            }
            _ => {}
        }
    }
    None
}

pub async fn call_bedrock(
    creds: &AwsCreds,
    http: &reqwest::Client,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<LlmResponse, String> {
    let body = serde_json::json!({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1200,
        "system": system_prompt,
        "messages": [{ "role": "user", "content": user_prompt }]
    });
    let body_bytes = serde_json::to_vec(&body).unwrap();

    let model_id = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
    let host = format!("bedrock-runtime.{}.amazonaws.com", creds.region);
    let path = format!("/model/{}/invoke", model_id);
    let url = format!("https://{}{}", host, path);

    let headers = sigv4_headers(creds, "POST", &host, &path, &body_bytes);
    let mut req = http.post(&url).body(body_bytes);
    for (k, v) in &headers { req = req.header(k.as_str(), v.as_str()); }

    let resp = tokio::time::timeout(Duration::from_secs(8), req.send())
        .await
        .map_err(|_| "Bedrock timeout".to_string())?
        .map_err(|e| format!("Bedrock request error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Bedrock HTTP {}: {}", status, &text[..text.len().min(300)]));
    }

    let resp_json: serde_json::Value = resp.json().await
        .map_err(|e| format!("Bedrock JSON parse: {}", e))?;

    let text = resp_json["content"][0]["text"].as_str()
        .ok_or("No text in Bedrock response")?;

    let json_str = extract_first_json(text)
        .ok_or_else(|| format!("No JSON in response: {}", &text[..text.len().min(400)]))?;

    serde_json::from_str::<LlmResponse>(json_str)
        .map_err(|e| format!("LLM parse error: {} — raw: {}", e, &json_str[..json_str.len().min(800)]))
}
