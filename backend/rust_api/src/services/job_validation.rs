use crate::config::ProviderLimitsConfig;
use crate::error::AppError;
use std::path::Path;

use crate::models::domain::{OcrProviderKind, UploadRecord, SOURCE_CLEANUP_STRATEGIES};
use crate::models::request::CreateJobInput;
use crate::ocr_provider::{
    parse_provider_kind, provider_display_name, provider_token, provider_token_field_name,
    require_supported_provider,
};

const RENDER_MODES: &[&str] = &["auto", "overlay", "typst", "typst_visual", "dual"];
const FONT_UNIFY_MODES: &[&str] = &["role_min", "off"];

pub fn validate_provider_credentials(input: &CreateJobInput) -> Result<(), AppError> {
    let provider_kind = require_supported_provider(input.ocr.provider.trim())
        .map_err(|err| AppError::bad_request(err.to_string()))?;
    validate_provider_token(input, &provider_kind)?;
    validate_translation_credentials(input)
}

pub fn validate_translation_credentials(input: &CreateJobInput) -> Result<(), AppError> {
    let base_url = input.translation.base_url.trim();
    let url = input.translation.url.trim();
    if base_url.is_empty() && url.is_empty() {
        return Err(AppError::bad_request("base_url is required"));
    }
    if !base_url.is_empty() && !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err(AppError::bad_request(
            "base_url must start with http:// or https://",
        ));
    }
    if !url.is_empty() && !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::bad_request(
            "url must start with http:// or https://",
        ));
    }

    let api_key = input.translation.api_key.trim();
    if api_key.is_empty() {
        return Err(AppError::bad_request("api_key is required"));
    }
    if looks_like_url(api_key) {
        return Err(AppError::bad_request(
            "api_key looks like a URL, not a model API key; check whether frontend fields were mixed up",
        ));
    }
    if input.translation.model.trim().is_empty() {
        return Err(AppError::bad_request("model is required"));
    }

    if let Some(temperature) = input.translation.temperature {
        if !temperature.is_finite() || !(0.0..=2.0).contains(&temperature) {
            return Err(AppError::bad_request("translation.temperature must be between 0.0 and 2.0"));
        }
    }
    if let Some(top_p) = input.translation.top_p {
        if !top_p.is_finite() || !(0.0..=1.0).contains(&top_p) {
            return Err(AppError::bad_request("translation.top_p must be between 0.0 and 1.0"));
        }
    }
    if let Some(timeout_seconds) = input.translation.timeout_seconds {
        if timeout_seconds <= 0 {
            return Err(AppError::bad_request("translation.timeout_seconds must be positive"));
        }
    }
    if let Some(max_retries) = input.translation.max_retries {
        if max_retries < 0 {
            return Err(AppError::bad_request("translation.max_retries must be non-negative"));
        }
    }
    Ok(())
}

pub fn validate_render_options(input: &CreateJobInput) -> Result<(), AppError> {
    validate_optional_output_filename(
        "render.translated_pdf_name",
        &input.render.translated_pdf_name,
    )?;
    validate_allowed_value(
        "render.render_mode",
        &input.render.render_mode,
        RENDER_MODES,
    )?;
    validate_allowed_value(
        "render.font_unify_mode",
        &input.render.font_unify_mode,
        FONT_UNIFY_MODES,
    )?;
    validate_allowed_value(
        "render.source_cleanup_strategy",
        &input.render.source_cleanup_strategy,
        SOURCE_CLEANUP_STRATEGIES,
    )?;
    if input.render.compile_workers < 0 {
        return Err(AppError::bad_request(
            "render.compile_workers must be greater than or equal to 0",
        ));
    }
    if input.render.pdf_compress_dpi < 0 {
        return Err(AppError::bad_request(
            "render.pdf_compress_dpi must be greater than or equal to 0",
        ));
    }
    validate_positive_finite(
        "render.body_font_size_factor",
        input.render.body_font_size_factor,
    )?;
    validate_positive_finite(
        "render.body_leading_factor",
        input.render.body_leading_factor,
    )?;
    validate_non_negative_finite(
        "render.inner_bbox_shrink_x",
        input.render.inner_bbox_shrink_x,
    )?;
    validate_non_negative_finite(
        "render.inner_bbox_shrink_y",
        input.render.inner_bbox_shrink_y,
    )?;
    validate_non_negative_finite(
        "render.inner_bbox_dense_shrink_x",
        input.render.inner_bbox_dense_shrink_x,
    )?;
    validate_non_negative_finite(
        "render.inner_bbox_dense_shrink_y",
        input.render.inner_bbox_dense_shrink_y,
    )?;
    Ok(())
}

fn validate_optional_output_filename(field: &str, value: &str) -> Result<(), AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let path = Path::new(trimmed);
    if path.is_absolute()
        || path.components().count() != 1
        || trimmed.contains('/')
        || trimmed.contains('\\')
    {
        return Err(AppError::bad_request(format!(
            "{field} must be a file name, not a path"
        )));
    }
    Ok(())
}

pub fn validate_ocr_provider_request(input: &CreateJobInput) -> Result<(), AppError> {
    let provider = input.ocr.provider.trim();
    if provider.is_empty() {
        return Err(AppError::bad_request("provider is required"));
    }
    let provider_kind = require_supported_provider(provider)
        .map_err(|err| AppError::bad_request(err.to_string()))?;
    validate_provider_token(input, &provider_kind)?;
    if !input.source.source_url.trim().is_empty()
        && !(input.source.source_url.starts_with("http://")
            || input.source.source_url.starts_with("https://"))
    {
        return Err(AppError::bad_request(
            "source_url must start with http:// or https://",
        ));
    }
    if input.runtime.timeout_seconds <= 0 {
        return Err(AppError::bad_request(
            "timeout_seconds must be a positive integer",
        ));
    }
    Ok(())
}

pub fn validate_mineru_upload_limits(
    input: &CreateJobInput,
    upload: &UploadRecord,
    limits: &ProviderLimitsConfig,
) -> Result<(), AppError> {
    match parse_provider_kind(&input.ocr.provider) {
        OcrProviderKind::Mineru => {
            validate_upload_limit(
                upload,
                "MinerU",
                limits.mineru_max_bytes,
                limits.mineru_max_pages,
                false,
            )?;
        }
        OcrProviderKind::Paddle => {
            validate_upload_limit(
                upload,
                "PaddleOCR",
                limits.paddle_max_bytes,
                limits.paddle_max_pages,
                true,
            )?;
        }
        OcrProviderKind::Local => {}
        OcrProviderKind::Unknown => {}
    }
    Ok(())
}

fn validate_upload_limit(
    upload: &UploadRecord,
    provider_name: &str,
    max_bytes: u64,
    max_pages: u32,
    bytes_inclusive: bool,
) -> Result<(), AppError> {
    let too_large = if bytes_inclusive {
        upload.bytes > max_bytes
    } else {
        upload.bytes >= max_bytes
    };
    if too_large {
        let relation = if bytes_inclusive {
            "不超过"
        } else {
            "小于"
        };
        return Err(AppError::bad_request(format!(
            "{provider_name} API 限制：PDF 文件大小必须{relation} {:.0}MB；当前文件为 {:.2}MB",
            max_bytes as f64 / 1024.0 / 1024.0,
            upload.bytes as f64 / 1024.0 / 1024.0
        )));
    }
    if upload.page_count > max_pages {
        return Err(AppError::bad_request(format!(
            "{provider_name} API 限制：PDF 页数必须不超过 {max_pages} 页；当前文件为 {} 页",
            upload.page_count
        )));
    }
    Ok(())
}

fn looks_like_url(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.starts_with("http://") || value.starts_with("https://")
}

fn validate_allowed_value(field: &str, value: &str, allowed: &[&str]) -> Result<(), AppError> {
    let normalized = value.trim().to_ascii_lowercase();
    if allowed.iter().any(|candidate| *candidate == normalized) {
        return Ok(());
    }
    Err(AppError::bad_request(format!(
        "{field} must be one of: {}",
        allowed.join(", ")
    )))
}

fn validate_positive_finite(field: &str, value: f64) -> Result<(), AppError> {
    if value.is_finite() && value > 0.0 {
        return Ok(());
    }
    Err(AppError::bad_request(format!(
        "{field} must be a positive finite number"
    )))
}

fn validate_non_negative_finite(field: &str, value: f64) -> Result<(), AppError> {
    if value.is_finite() && value >= 0.0 {
        return Ok(());
    }
    Err(AppError::bad_request(format!(
        "{field} must be a non-negative finite number"
    )))
}

fn validate_provider_token(
    input: &CreateJobInput,
    provider_kind: &OcrProviderKind,
) -> Result<(), AppError> {
    if matches!(provider_kind, OcrProviderKind::Local) {
        return Ok(());
    }
    let token = provider_token(provider_kind, &input.ocr);
    let field_name = provider_token_field_name(provider_kind).unwrap_or("provider_token");
    let display_name = provider_display_name(provider_kind).unwrap_or("Provider");
    if token.is_empty() {
        return Err(AppError::bad_request(format!("{field_name} is required")));
    }
    if looks_like_url(token) {
        return Err(AppError::bad_request(format!(
            "{field_name} looks like a URL, not a {display_name} API key; check whether frontend fields were mixed up",
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::domain::{now_iso, DEFAULT_SOURCE_CLEANUP_STRATEGY};

    fn default_limits() -> ProviderLimitsConfig {
        ProviderLimitsConfig::from_env()
    }

    fn paddle_input() -> CreateJobInput {
        let mut input = CreateJobInput::default();
        input.ocr.provider = "paddle".to_string();
        input
    }

    fn local_input() -> CreateJobInput {
        let mut input = CreateJobInput::default();
        input.ocr.provider = "local".to_string();
        input
    }

    fn upload_with_pages(page_count: u32) -> UploadRecord {
        UploadRecord {
            upload_id: "upload-test".to_string(),
            filename: "paper.pdf".to_string(),
            stored_path: "/tmp/paper.pdf".to_string(),
            bytes: 1,
            page_count,
            uploaded_at: now_iso(),
            developer_mode: false,
            content_hash: String::new(),
        }
    }

    #[test]
    fn paddle_upload_limit_allows_533_pages() {
        assert!(validate_mineru_upload_limits(
            &paddle_input(),
            &upload_with_pages(533),
            &default_limits()
        )
        .is_ok());
    }

    #[test]
    fn paddle_upload_limit_rejects_pages_above_999() {
        let err = validate_mineru_upload_limits(
            &paddle_input(),
            &upload_with_pages(1000),
            &default_limits(),
        )
        .expect_err("1000 pages should exceed Paddle limit");
        assert!(err.to_string().contains("不超过 999 页"));
    }

    #[test]
    fn local_provider_does_not_require_remote_provider_token() {
        assert!(validate_ocr_provider_request(&local_input()).is_ok());
    }

    #[test]
    fn local_provider_does_not_apply_remote_upload_limits() {
        assert!(validate_mineru_upload_limits(
            &local_input(),
            &upload_with_pages(5000),
            &default_limits()
        )
        .is_ok());
    }

    #[test]
    fn render_options_accept_current_defaults() {
        let input = CreateJobInput::default();
        assert_eq!(
            input.render.source_cleanup_strategy,
            DEFAULT_SOURCE_CLEANUP_STRATEGY
        );
        assert!(SOURCE_CLEANUP_STRATEGIES.contains(&DEFAULT_SOURCE_CLEANUP_STRATEGY));
        assert!(validate_render_options(&input).is_ok());
    }

    #[test]
    fn render_options_accept_pikepdf_text_strip_cleanup_strategy() {
        let mut input = CreateJobInput::default();
        input.render.source_cleanup_strategy = "pikepdf_text_strip".to_string();
        assert!(validate_render_options(&input).is_ok());
    }

    #[test]
    fn render_options_reject_unknown_cleanup_strategy() {
        let mut input = CreateJobInput::default();
        input.render.source_cleanup_strategy = "delete_everything".to_string();
        let err = validate_render_options(&input).expect_err("unknown strategy should fail");
        assert!(err
            .to_string()
            .contains("render.source_cleanup_strategy must be one of"));
    }

    #[test]
    fn render_options_reject_negative_compress_dpi() {
        let mut input = CreateJobInput::default();
        input.render.pdf_compress_dpi = -1;
        let err = validate_render_options(&input).expect_err("negative dpi should fail");
        assert!(err
            .to_string()
            .contains("render.pdf_compress_dpi must be greater than or equal to 0"));
    }

    #[test]
    fn render_options_reject_translated_pdf_name_path_escape() {
        let mut input = CreateJobInput::default();
        input.render.translated_pdf_name = "../outside.pdf".to_string();
        let err = validate_render_options(&input).expect_err("path output should fail");
        assert!(err
            .to_string()
            .contains("render.translated_pdf_name must be a file name"));
    }

    #[test]
    fn translation_credentials_accept_custom_model_url_and_parameters() {
        let mut input = CreateJobInput::default();
        input.translation.model = "gpt-4o".to_string();
        input.translation.api_key = "sk-test-key".to_string();
        input.translation.url = "https://custom-gateway.com/v1/chat/completions".to_string();
        input.translation.temperature = Some(0.7);
        input.translation.top_p = Some(0.9);
        input.translation.timeout_seconds = Some(180);
        input.translation.max_retries = Some(3);
        assert!(validate_translation_credentials(&input).is_ok());
    }

    #[test]
    fn translation_credentials_reject_invalid_temperature_or_top_p() {
        let mut input = CreateJobInput::default();
        input.translation.model = "deepseek-chat".to_string();
        input.translation.api_key = "sk-test-key".to_string();
        input.translation.base_url = "https://api.deepseek.com/v1".to_string();

        input.translation.temperature = Some(2.5);
        let err = validate_translation_credentials(&input).expect_err("temperature > 2 should fail");
        assert!(err.to_string().contains("temperature must be between 0.0 and 2.0"));

        input.translation.temperature = Some(0.2);
        input.translation.top_p = Some(1.5);
        let err_top_p = validate_translation_credentials(&input).expect_err("top_p > 1.0 should fail");
        assert!(err_top_p.to_string().contains("top_p must be between 0.0 and 1.0"));
    }
}
