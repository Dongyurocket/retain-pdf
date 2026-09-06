use std::collections::HashMap;

use crate::db::Db;
use crate::error::AppError;
use crate::models::api::ListGlossariesQuery;
use crate::models::domain::{build_glossary_id, now_iso, GlossaryRecord};
use crate::models::request::{
    CreateJobInput, GlossaryCsvParseInput, GlossaryEntryInput, GlossaryUpsertInput,
};

const MAX_GLOSSARY_ENTRIES: usize = 200;
const MAX_GLOSSARY_NAME_LEN: usize = 120;
const MAX_GLOSSARY_TERM_LEN: usize = 200;
const MAX_GLOSSARY_NOTE_LEN: usize = 500;

pub fn create_glossary(db: &Db, input: &GlossaryUpsertInput) -> Result<GlossaryRecord, AppError> {
    let name = normalize_glossary_name(&input.name)?;
    let entries = normalize_glossary_entries(&input.entries)?;
    let description = normalize_glossary_description(&input.description)?;
    let source_lang = normalize_glossary_lang(&input.source_lang)?;
    let target_lang = normalize_glossary_lang(&input.target_lang)?;
    let now = now_iso();
    let record = GlossaryRecord {
        glossary_id: build_glossary_id(),
        name,
        description,
        source_lang,
        target_lang,
        enabled: input.enabled,
        entries,
        created_at: now.clone(),
        updated_at: now,
    };
    db.save_glossary(&record)?;
    Ok(record)
}

pub fn update_glossary(
    db: &Db,
    glossary_id: &str,
    input: &GlossaryUpsertInput,
) -> Result<GlossaryRecord, AppError> {
    let previous = load_glossary_or_404(db, glossary_id)?;
    let record = GlossaryRecord {
        glossary_id: previous.glossary_id,
        name: normalize_glossary_name(&input.name)?,
        description: normalize_glossary_description(&input.description)?,
        source_lang: normalize_glossary_lang(&input.source_lang)?,
        target_lang: normalize_glossary_lang(&input.target_lang)?,
        enabled: input.enabled,
        entries: normalize_glossary_entries(&input.entries)?,
        created_at: previous.created_at,
        updated_at: now_iso(),
    };
    db.save_glossary(&record)?;
    Ok(record)
}

pub fn list_glossaries(db: &Db) -> Result<Vec<GlossaryRecord>, AppError> {
    let mut items = db.list_glossaries()?;
    items.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.glossary_id.cmp(&b.glossary_id))
    });
    Ok(items)
}

pub fn filter_glossaries(
    items: Vec<GlossaryRecord>,
    query: &ListGlossariesQuery,
) -> Vec<GlossaryRecord> {
    items
        .into_iter()
        .filter(|item| {
            query
                .enabled
                .map(|enabled| item.enabled == enabled)
                .unwrap_or(true)
        })
        .filter(|item| {
            query
                .source_lang
                .as_ref()
                .map(|lang| item.source_lang.eq_ignore_ascii_case(lang.trim()))
                .unwrap_or(true)
        })
        .filter(|item| {
            query
                .target_lang
                .as_ref()
                .map(|lang| item.target_lang.eq_ignore_ascii_case(lang.trim()))
                .unwrap_or(true)
        })
        .filter(|item| {
            query
                .q
                .as_ref()
                .map(|needle| {
                    let needle = needle.trim().to_lowercase();
                    !needle.is_empty()
                        && (item.name.to_lowercase().contains(&needle)
                            || item.description.to_lowercase().contains(&needle)
                            || item.glossary_id.to_lowercase().contains(&needle))
                })
                .unwrap_or(true)
        })
        .collect()
}

pub fn load_glossary_or_404(db: &Db, glossary_id: &str) -> Result<GlossaryRecord, AppError> {
    db.get_glossary(glossary_id)
        .map_err(|_| AppError::not_found(format!("glossary not found: {glossary_id}")))
}

pub fn delete_glossary(db: &Db, glossary_id: &str) -> Result<(), AppError> {
    load_glossary_or_404(db, glossary_id)?;
    db.delete_glossary(glossary_id)?;
    Ok(())
}

pub fn parse_glossary_csv(
    input: &GlossaryCsvParseInput,
) -> Result<Vec<GlossaryEntryInput>, AppError> {
    parse_glossary_text(&input.csv_text)
}

pub fn resolve_task_glossary_request(
    db: &Db,
    input: &CreateJobInput,
) -> Result<CreateJobInput, AppError> {
    let mut resolved = input.clone();
    let inline_entries = normalize_glossary_entries(&input.translation.glossary_entries)?;
    resolved.translation.glossary_inline_entry_count = inline_entries.len() as i64;
    let glossary_id = input.translation.glossary_id.trim();
    if glossary_id.is_empty() {
        resolved.translation.glossary_entries = inline_entries;
        resolved.translation.glossary_name.clear();
        resolved.translation.glossary_resource_entry_count = 0;
        resolved.translation.glossary_overridden_entry_count = 0;
        return Ok(resolved);
    }

    let glossary = load_glossary_or_404(db, glossary_id)?;
    let base_entries = normalize_glossary_entries(&glossary.entries)?;
    let overridden_entry_count = count_overridden_entries(&base_entries, &inline_entries);
    let merged_entries = merge_glossary_entries(&base_entries, &inline_entries);
    if merged_entries.len() > MAX_GLOSSARY_ENTRIES {
        return Err(AppError::bad_request(format!(
            "merged glossary entry count exceeds {MAX_GLOSSARY_ENTRIES}"
        )));
    }
    resolved.translation.glossary_id = glossary.glossary_id;
    resolved.translation.glossary_name = glossary.name;
    resolved.translation.glossary_resource_entry_count = base_entries.len() as i64;
    resolved.translation.glossary_overridden_entry_count = overridden_entry_count as i64;
    resolved.translation.glossary_entries = merged_entries;
    Ok(resolved)
}

pub fn normalize_glossary_entries(
    entries: &[GlossaryEntryInput],
) -> Result<Vec<GlossaryEntryInput>, AppError> {
    let mut normalized = Vec::new();
    for entry in entries {
        let source = sanitize_csv_cell(&entry.source);
        let mut target = sanitize_csv_cell(&entry.target);
        let note = sanitize_csv_cell(&entry.note);
        let level = normalize_glossary_level(&entry.level);
        let match_mode = normalize_glossary_match_mode(&entry.match_mode);
        let context = sanitize_csv_cell(&entry.context);
        if source.is_empty() && target.is_empty() && note.is_empty() && context.is_empty() {
            continue;
        }
        if level == "preserve" && !source.is_empty() && target.is_empty() {
            target = source.clone();
        }
        if source.is_empty() || target.is_empty() {
            return Err(AppError::bad_request(
                "glossary entry requires both source and target",
            ));
        }
        if source.chars().count() > MAX_GLOSSARY_TERM_LEN {
            return Err(AppError::bad_request(format!(
                "glossary source exceeds {MAX_GLOSSARY_TERM_LEN} characters"
            )));
        }
        if target.chars().count() > MAX_GLOSSARY_TERM_LEN {
            return Err(AppError::bad_request(format!(
                "glossary target exceeds {MAX_GLOSSARY_TERM_LEN} characters"
            )));
        }
        if note.chars().count() > MAX_GLOSSARY_NOTE_LEN {
            return Err(AppError::bad_request(format!(
                "glossary note exceeds {MAX_GLOSSARY_NOTE_LEN} characters"
            )));
        }
        normalized.push(GlossaryEntryInput {
            source,
            target,
            note,
            level,
            match_mode,
            context,
        });
    }
    let deduped = dedupe_glossary_entries(normalized);
    if deduped.len() > MAX_GLOSSARY_ENTRIES {
        return Err(AppError::bad_request(format!(
            "glossary entry count exceeds {MAX_GLOSSARY_ENTRIES}"
        )));
    }
    Ok(deduped)
}

pub fn merge_glossary_entries(
    base_entries: &[GlossaryEntryInput],
    overlay_entries: &[GlossaryEntryInput],
) -> Vec<GlossaryEntryInput> {
    let mut merged = Vec::with_capacity(base_entries.len() + overlay_entries.len());
    let mut index_by_key: HashMap<String, usize> = HashMap::new();
    for entry in base_entries.iter().chain(overlay_entries.iter()) {
        let key = glossary_entry_key(&entry.source);
        if let Some(index) = index_by_key.get(&key).copied() {
            merged[index] = entry.clone();
        } else {
            index_by_key.insert(key, merged.len());
            merged.push(entry.clone());
        }
    }
    merged
}

fn normalize_glossary_name(name: &str) -> Result<String, AppError> {
    let normalized = name.trim();
    if normalized.is_empty() {
        return Err(AppError::bad_request("glossary name is required"));
    }
    if normalized.chars().count() > MAX_GLOSSARY_NAME_LEN {
        return Err(AppError::bad_request(format!(
            "glossary name exceeds {MAX_GLOSSARY_NAME_LEN} characters"
        )));
    }
    Ok(normalized.to_string())
}

fn normalize_glossary_description(description: &str) -> Result<String, AppError> {
    let normalized = description.trim();
    if normalized.chars().count() > 500 {
        return Err(AppError::bad_request(
            "glossary description exceeds 500 characters",
        ));
    }
    Ok(normalized.to_string())
}

fn normalize_glossary_lang(value: &str) -> Result<String, AppError> {
    let normalized = value.trim();
    if normalized.chars().count() > 64 {
        return Err(AppError::bad_request(
            "glossary language exceeds 64 characters",
        ));
    }
    Ok(normalized.to_string())
}

fn parse_glossary_text(text: &str) -> Result<Vec<GlossaryEntryInput>, AppError> {
    let text = text.trim_start_matches('\u{feff}');
    let has_tabs = text.lines().any(|line| line.contains('\t'));
    let has_commas = text.contains(',');
    
    if has_tabs && (!has_commas || text.lines().next().map(|l| l.matches('\t').count() > l.matches(',').count()).unwrap_or(false)) {
        // TSV/Tab-separated text parsing (e.g. copied from Excel or simple text file)
        let mut entries = Vec::new();
        let lines: Vec<&str> = text.lines().collect();
        if lines.is_empty() {
            return Ok(Vec::new());
        }
        
        let header_row: Vec<String> = lines[0].split('\t').map(|s| s.trim().to_string()).collect();
        let header_map = detect_csv_header_strings(&header_row);
        let data_lines: &[&str] = if header_map.is_some() {
            &lines[1..]
        } else {
            &lines
        };
        
        for line in data_lines {
            let cols: Vec<String> = line.split('\t').map(|s| s.trim().to_string()).collect();
            if cols.iter().all(|s| s.trim().is_empty()) {
                continue;
            }
            let entry = parse_txt_row(&cols, header_map.as_ref())?;
            if let Some(entry) = entry {
                entries.push(entry);
            }
        }
        normalize_glossary_entries(&entries)
    } else {
        // Standard CSV parsing
        parse_glossary_csv_text(text)
    }
}

fn parse_txt_row(
    cols: &[String],
    header_map: Option<&GlossaryCsvHeader>,
) -> Result<Option<GlossaryEntryInput>, AppError> {
    let (source_idx, target_idx, note_idx, level_idx, match_mode_idx, context_idx) = header_map
        .map(|header| {
            (
                header.source_idx,
                header.target_idx,
                header.note_idx,
                header.level_idx,
                header.match_mode_idx,
                header.context_idx,
            )
        })
        .unwrap_or((0, 1, Some(2), None, None, None));
        
    let get_cell = |idx: usize| -> String {
        if idx < cols.len() {
            sanitize_csv_cell(&cols[idx])
        } else {
            "".to_string()
        }
    };
    
    let get_opt_cell = |idx: Option<usize>| -> String {
        idx.map(|i| get_cell(i)).unwrap_or_default()
    };

    let source = get_cell(source_idx);
    let target = get_cell(target_idx);
    let note = get_opt_cell(note_idx);
    let level = if let Some(idx) = level_idx {
        normalize_glossary_level(&get_cell(idx))
    } else {
        "preferred".to_string()
    };
    let match_mode = if let Some(idx) = match_mode_idx {
        normalize_glossary_match_mode(&get_cell(idx))
    } else {
        "exact".to_string()
    };
    let context = get_opt_cell(context_idx);

    if source.is_empty() && target.is_empty() && note.is_empty() {
        return Ok(None);
    }
    Ok(Some(GlossaryEntryInput {
        source,
        target,
        note,
        level,
        match_mode,
        context,
    }))
}

fn parse_glossary_csv_text(csv_text: &str) -> Result<Vec<GlossaryEntryInput>, AppError> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(csv_text.as_bytes());
    let mut rows = Vec::new();
    for record in reader.records() {
        let record =
            record.map_err(|err| AppError::bad_request(format!("invalid glossary csv: {err}")))?;
        rows.push(record);
    }
    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let header_map = detect_csv_header(&rows[0]);
    let data_rows: &[csv::StringRecord] = if header_map.is_some() {
        &rows[1..]
    } else {
        &rows
    };
    let mut entries = Vec::new();
    for row in data_rows {
        let entry = parse_csv_row(row, header_map.as_ref())?;
        if let Some(entry) = entry {
            entries.push(entry);
        }
    }
    normalize_glossary_entries(&entries)
}

fn parse_csv_row(
    row: &csv::StringRecord,
    header_map: Option<&GlossaryCsvHeader>,
) -> Result<Option<GlossaryEntryInput>, AppError> {
    let (source_idx, target_idx, note_idx, level_idx, match_mode_idx, context_idx) = header_map
        .map(|header| {
            (
                header.source_idx,
                header.target_idx,
                header.note_idx,
                header.level_idx,
                header.match_mode_idx,
                header.context_idx,
            )
        })
        .unwrap_or((0, 1, Some(2), None, None, None));
    let source = sanitize_csv_cell(row.get(source_idx).unwrap_or_default());
    let target = sanitize_csv_cell(row.get(target_idx).unwrap_or_default());
    let note = note_idx
        .and_then(|index| row.get(index))
        .map(sanitize_csv_cell)
        .unwrap_or_default();
    let level = level_idx
        .and_then(|index| row.get(index))
        .map(normalize_glossary_level)
        .unwrap_or_else(|| "preferred".to_string());
    let match_mode = match_mode_idx
        .and_then(|index| row.get(index))
        .map(normalize_glossary_match_mode)
        .unwrap_or_else(|| "exact".to_string());
    let context = context_idx
        .and_then(|index| row.get(index))
        .map(sanitize_csv_cell)
        .unwrap_or_default();
    if source.is_empty() && target.is_empty() && note.is_empty() {
        return Ok(None);
    }
    Ok(Some(GlossaryEntryInput {
        source,
        target,
        note,
        level,
        match_mode,
        context,
    }))
}

fn normalize_glossary_level(value: &str) -> String {
    match sanitize_csv_cell(value).to_ascii_lowercase().as_str() {
        "preserve" | "keep" | "keep_origin" | "keep-original" | "do_not_translate"
        | "do-not-translate" | "not_translate" | "not-translate" | "no_translate"
        | "no-translate" | "不翻译" | "保留" | "原文保留" => "preserve".to_string(),
        "canonical" | "fixed" | "fixed_translation" | "fixed-translation" | "required"
        | "强制翻译" | "固定翻译" | "专业译法" | "标准译法" => {
            "canonical".to_string()
        }
        _ => "preferred".to_string(),
    }
}

fn normalize_glossary_match_mode(value: &str) -> String {
    match sanitize_csv_cell(value).to_ascii_lowercase().as_str() {
        "regex" => "regex".to_string(),
        "case_insensitive" | "case-insensitive" | "ci" | "ignore_case" | "ignore-case"
        | "大小写不敏感" | "忽略大小写" => "case_insensitive".to_string(),
        _ => "exact".to_string(),
    }
}

#[derive(Debug, Clone, Copy)]
struct GlossaryCsvHeader {
    source_idx: usize,
    target_idx: usize,
    note_idx: Option<usize>,
    level_idx: Option<usize>,
    match_mode_idx: Option<usize>,
    context_idx: Option<usize>,
}

fn detect_csv_header_strings(row: &[String]) -> Option<GlossaryCsvHeader> {
    let mut source_idx = None;
    let mut target_idx = None;
    let mut note_idx = None;
    let mut level_idx = None;
    let mut match_mode_idx = None;
    let mut context_idx = None;
    for (index, value) in row.iter().enumerate() {
        let normalized = sanitize_csv_cell(value).to_ascii_lowercase();
        match normalized.as_str() {
            "source" | "src" | "term" | "original" | "原词" | "原文" | "术语" => {
                source_idx = Some(index)
            }
            "target" | "dst" | "translation" | "translated" | "译文" | "翻译" | "目标译文" => {
                target_idx = Some(index)
            }
            "note" | "notes" | "comment" | "comments" | "备注" | "说明" => {
                note_idx = Some(index)
            }
            "level" | "glossary_level" | "mode" | "action" | "类型" | "模式" | "动作" => {
                level_idx = Some(index)
            }
            "match" | "match_mode" | "match-mode" | "匹配" | "匹配模式" => {
                match_mode_idx = Some(index)
            }
            "context" | "上下文" | "语境" => context_idx = Some(index),
            _ => {}
        }
    }
    match (source_idx, target_idx) {
        (Some(source_idx), Some(target_idx)) => Some(GlossaryCsvHeader {
            source_idx,
            target_idx,
            note_idx,
            level_idx,
            match_mode_idx,
            context_idx,
        }),
        _ => None,
    }
}

fn detect_csv_header(row: &csv::StringRecord) -> Option<GlossaryCsvHeader> {
    let cols: Vec<String> = row.iter().map(|s| s.to_string()).collect();
    detect_csv_header_strings(&cols)
}

fn dedupe_glossary_entries(entries: Vec<GlossaryEntryInput>) -> Vec<GlossaryEntryInput> {
    let mut deduped = Vec::with_capacity(entries.len());
    let mut index_by_key: HashMap<String, usize> = HashMap::new();
    for entry in entries {
        let key = glossary_entry_key(&entry.source);
        if let Some(index) = index_by_key.get(&key).copied() {
            deduped[index] = entry;
        } else {
            index_by_key.insert(key, deduped.len());
            deduped.push(entry);
        }
    }
    deduped
}

fn glossary_entry_key(source: &str) -> String {
    source.trim().to_ascii_lowercase()
}

fn count_overridden_entries(
    base_entries: &[GlossaryEntryInput],
    overlay_entries: &[GlossaryEntryInput],
) -> usize {
    let base_keys: HashMap<String, ()> = base_entries
        .iter()
        .map(|entry| (glossary_entry_key(&entry.source), ()))
        .collect();
    overlay_entries
        .iter()
        .filter(|entry| base_keys.contains_key(&glossary_entry_key(&entry.source)))
        .count()
}

fn sanitize_csv_cell(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('\u{feff}')
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::Arc;

    use tokio::sync::{Mutex, RwLock, Semaphore};

    use crate::config::AppConfig;
    use crate::db::Db;
    use crate::models::api::glossary_to_csv_export;
    use crate::models::request::{CreateJobInput, GlossaryEntryInput};
    use crate::AppState;

    use super::*;

    fn test_state() -> AppState {
        let root = std::env::temp_dir().join(format!(
            "rust-api-glossaries-{}-{}",
            std::process::id(),
            fastrand::u64(..)
        ));
        let data_root = root.join("data");
        let output_root = data_root.join("jobs");
        let downloads_dir = data_root.join("downloads");
        let uploads_dir = data_root.join("uploads");
        let rust_api_root = root.join("rust_api");
        let scripts_dir = root.join("scripts");
        std::fs::create_dir_all(&output_root).expect("create output root");
        std::fs::create_dir_all(&downloads_dir).expect("create downloads dir");
        std::fs::create_dir_all(&uploads_dir).expect("create uploads dir");
        std::fs::create_dir_all(&rust_api_root).expect("create rust_api root");
        std::fs::create_dir_all(&scripts_dir).expect("create scripts dir");

        let config = Arc::new(AppConfig {
            project_root: root.clone(),
            rust_api_root,
            data_root: data_root.clone(),
            scripts_dir: scripts_dir.clone(),
            run_provider_case_script: scripts_dir.join("run_provider_case.py"),
            run_provider_ocr_script: scripts_dir.join("run_provider_ocr.py"),
            run_normalize_ocr_script: scripts_dir.join("run_normalize_ocr.py"),
            run_translate_from_ocr_script: scripts_dir.join("run_translate_from_ocr.py"),
            run_translate_only_script: scripts_dir.join("run_translate_only.py"),
            run_render_only_script: scripts_dir.join("run_render_only.py"),
            run_failure_ai_diagnosis_script: scripts_dir.join("diagnose_failure_with_ai.py"),
            uploads_dir,
            downloads_dir,
            jobs_db_path: data_root.join("db").join("jobs.db"),
            output_root,
            python_bin: "python".to_string(),
            python_entrypoint_mode: crate::config::PythonWorkerEntrypointMode::Script,
            bind_host: "127.0.0.1".to_string(),
            port: 41000,
            simple_port: 41001,
            upload_max_bytes: 0,
            upload_max_pages: 0,
            api_keys: HashSet::new(),
            max_running_jobs: 1,
            provider_limits: crate::config::ProviderLimitsConfig::default(),
            provider_runtime: crate::config::ProviderRuntimeConfig::default(),
            job_runner: crate::config::JobRunnerConfig::default(),
        });

        let db = Arc::new(Db::new(
            config.jobs_db_path.clone(),
            config.data_root.clone(),
        ));
        db.init().expect("init db");
        AppState {
            config,
            db,
            downloads_lock: Arc::new(Mutex::new(())),
            canceled_jobs: Arc::new(RwLock::new(HashSet::new())),
            job_slots: Arc::new(Semaphore::new(1)),
        }
    }

    fn entry(source: &str, target: &str) -> GlossaryEntryInput {
        GlossaryEntryInput {
            source: source.to_string(),
            target: target.to_string(),
            note: String::new(),
            level: String::new(),
            match_mode: String::new(),
            context: String::new(),
        }
    }

    #[test]
    fn normalize_glossary_entries_dedupes_and_trims() {
        let entries = normalize_glossary_entries(&[
            GlossaryEntryInput {
                source: " DNA ".to_string(),
                target: " 脱氧核糖核酸 ".to_string(),
                note: String::new(),
                level: "preserve".to_string(),
                match_mode: "case-insensitive".to_string(),
                context: " biology ".to_string(),
            },
            GlossaryEntryInput {
                source: "dna".to_string(),
                target: "DNA".to_string(),
                note: "override".to_string(),
                level: "canonical".to_string(),
                match_mode: "regex".to_string(),
                context: String::new(),
            },
        ])
        .expect("normalize entries");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source, "dna");
        assert_eq!(entries[0].target, "DNA");
        assert_eq!(entries[0].level, "canonical");
        assert_eq!(entries[0].match_mode, "regex");
    }

    #[test]
    fn parse_glossary_csv_supports_header_and_note() {
        let entries = parse_glossary_csv_text("source,target,note,level,match_mode,context\nabstract,摘要,section title,canonical,case-insensitive,paper\n")
            .expect("parse csv");
        assert_eq!(
            entries,
            vec![GlossaryEntryInput {
                source: "abstract".to_string(),
                target: "摘要".to_string(),
                note: "section title".to_string(),
                level: "canonical".to_string(),
                match_mode: "case_insensitive".to_string(),
                context: "paper".to_string(),
            }]
        );
    }

    #[test]
    fn preserve_glossary_entry_can_omit_target() {
        let entries = normalize_glossary_entries(&[GlossaryEntryInput {
            source: " Hartree-Fock ".to_string(),
            target: String::new(),
            note: String::new(),
            level: "不翻译".to_string(),
            match_mode: "忽略大小写".to_string(),
            context: String::new(),
        }])
        .expect("normalize preserve entry");

        assert_eq!(entries[0].source, "Hartree-Fock");
        assert_eq!(entries[0].target, "Hartree-Fock");
        assert_eq!(entries[0].level, "preserve");
        assert_eq!(entries[0].match_mode, "case_insensitive");
    }

    #[test]
    fn parse_glossary_csv_supports_chinese_table_headers() {
        let entries = parse_glossary_csv_text("原词,译文,类型,匹配模式,备注\nKohn-Sham,,保留,忽略大小写,method name\nDFT,density functional theory,专业译法,exact,expanded form\n")
            .expect("parse csv");

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].source, "Kohn-Sham");
        assert_eq!(entries[0].target, "Kohn-Sham");
        assert_eq!(entries[0].level, "preserve");
        assert_eq!(entries[0].match_mode, "case_insensitive");
        assert_eq!(entries[1].level, "canonical");
    }

    #[test]
    fn parse_glossary_text_supports_txt_tab_separated() {
        let input = "原词\t译文\t类型\t匹配模式\t备注\nKohn-Sham\t\t保留\t忽略大小写\tmethod name\nDFT\tdensity functional theory\t专业译法\texact\texpanded form";
        let entries = parse_glossary_text(input).expect("parse tsv");

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].source, "Kohn-Sham");
        assert_eq!(entries[0].target, "Kohn-Sham");
        assert_eq!(entries[0].level, "preserve");
        assert_eq!(entries[1].target, "density functional theory");
    }

    #[test]
    fn parse_glossary_text_supports_txt_no_header() {
        let input = "ab initio\t从头算\nHartree-Fock\tHartree-Fock";
        let entries = parse_glossary_text(input).expect("parse tsv without header");

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].source, "ab initio");
        assert_eq!(entries[0].target, "从头算");
    }

    #[test]
    fn glossary_csv_export_escapes_cells() {
        let record = GlossaryRecord {
            glossary_id: "glossary-1".to_string(),
            name: "physics".to_string(),
            description: String::new(),
            source_lang: "en".to_string(),
            target_lang: "zh-CN".to_string(),
            enabled: true,
            entries: vec![GlossaryEntryInput {
                source: "density, of states".to_string(),
                target: "态\"密度".to_string(),
                note: "materials".to_string(),
                level: "canonical".to_string(),
                match_mode: "exact".to_string(),
                context: String::new(),
            }],
            created_at: now_iso(),
            updated_at: now_iso(),
        };

        let export = glossary_to_csv_export(&record);

        assert!(export
            .csv_text
            .starts_with("source,target,note,level,match_mode,context\n"));
        assert!(export.csv_text.contains("\"density, of states\""));
        assert!(export.csv_text.contains("\"态\"\"密度\""));
    }

    #[test]
    fn merge_glossary_entries_prefers_overlay() {
        let merged = merge_glossary_entries(
            &[entry("DNA", "脱氧核糖核酸"), entry("abstract", "摘要")],
            &[entry("DNA", "DNA"), entry("band gap", "带隙")],
        );
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].source, "DNA");
        assert_eq!(merged[0].target, "DNA");
        assert_eq!(merged[2].source, "band gap");
    }

    #[test]
    fn resolve_task_glossary_request_merges_resource_and_inline_entries() {
        let state = test_state();
        let glossary = create_glossary(
            state.db.as_ref(),
            &GlossaryUpsertInput {
                glossary_id: String::new(),
                name: "chemistry".to_string(),
                description: "chemistry terms".to_string(),
                source_lang: "en".to_string(),
                target_lang: "zh-CN".to_string(),
                enabled: true,
                entries: vec![entry("DNA", "脱氧核糖核酸"), entry("abstract", "摘要")],
            },
        )
        .expect("create glossary");
        let mut input = CreateJobInput::default();
        input.translation.glossary_id = glossary.glossary_id.clone();
        input.translation.glossary_entries = vec![entry("DNA", "DNA"), entry("band gap", "带隙")];

        let resolved =
            resolve_task_glossary_request(state.db.as_ref(), &input).expect("resolve glossary");

        assert_eq!(resolved.translation.glossary_id, glossary.glossary_id);
        assert_eq!(resolved.translation.glossary_name, "chemistry");
        assert_eq!(resolved.translation.glossary_entries.len(), 3);
        assert_eq!(resolved.translation.glossary_entries[0].target, "DNA");
    }

    #[test]
    fn glossary_crud_round_trip() {
        let state = test_state();
        let created = create_glossary(
            state.db.as_ref(),
            &GlossaryUpsertInput {
                glossary_id: String::new(),
                name: "semiconductor".to_string(),
                description: "physics glossary".to_string(),
                source_lang: "en".to_string(),
                target_lang: "zh-CN".to_string(),
                enabled: true,
                entries: vec![entry("band gap", "带隙")],
            },
        )
        .expect("create glossary");
        let loaded =
            load_glossary_or_404(state.db.as_ref(), &created.glossary_id).expect("load glossary");
        assert_eq!(loaded.name, "semiconductor");
        assert_eq!(
            list_glossaries(state.db.as_ref())
                .expect("list glossaries")
                .len(),
            1
        );

        let updated = update_glossary(
            state.db.as_ref(),
            &created.glossary_id,
            &GlossaryUpsertInput {
                glossary_id: String::new(),
                name: "physics".to_string(),
                description: "updated".to_string(),
                source_lang: "en".to_string(),
                target_lang: "zh-CN".to_string(),
                enabled: false,
                entries: vec![entry("band gap", "带隙"), entry("exciton", "激子")],
            },
        )
        .expect("update glossary");
        assert_eq!(updated.name, "physics");
        assert!(!updated.enabled);
        assert_eq!(updated.entries.len(), 2);

        delete_glossary(state.db.as_ref(), &created.glossary_id).expect("delete glossary");
        let err = load_glossary_or_404(state.db.as_ref(), &created.glossary_id)
            .expect_err("deleted glossary");
        assert!(err.to_string().contains("not found"));
    }

    #[test]
    fn import_glossary_payload_can_update_existing_record() {
        let state = test_state();
        let created = create_glossary(
            state.db.as_ref(),
            &GlossaryUpsertInput {
                glossary_id: String::new(),
                name: "initial".to_string(),
                description: String::new(),
                source_lang: "en".to_string(),
                target_lang: "zh-CN".to_string(),
                enabled: true,
                entries: vec![entry("band gap", "带隙")],
            },
        )
        .expect("create glossary");

        let updated = update_glossary(
            state.db.as_ref(),
            &created.glossary_id,
            &GlossaryUpsertInput {
                glossary_id: created.glossary_id.clone(),
                name: "imported".to_string(),
                description: "imported glossary".to_string(),
                source_lang: "en".to_string(),
                target_lang: "zh-CN".to_string(),
                enabled: false,
                entries: vec![entry("exciton", "激子")],
            },
        )
        .expect("import update");

        assert_eq!(updated.glossary_id, created.glossary_id);
        assert_eq!(updated.name, "imported");
        assert!(!updated.enabled);
        assert_eq!(updated.entries[0].source, "exciton");
    }

    #[test]
    fn filter_glossaries_filters_by_enabled_and_language_and_query() {
        let items = vec![
            GlossaryRecord {
                glossary_id: "glossary-1".to_string(),
                name: "physics".to_string(),
                description: "physics glossary".to_string(),
                source_lang: "en".to_string(),
                target_lang: "zh-CN".to_string(),
                enabled: true,
                entries: vec![],
                created_at: now_iso(),
                updated_at: now_iso(),
            },
            GlossaryRecord {
                glossary_id: "glossary-2".to_string(),
                name: "chemistry".to_string(),
                description: "chemistry glossary".to_string(),
                source_lang: "en".to_string(),
                target_lang: "zh-TW".to_string(),
                enabled: false,
                entries: vec![],
                created_at: now_iso(),
                updated_at: now_iso(),
            },
        ];

        let filtered = filter_glossaries(
            items,
            &ListGlossariesQuery {
                enabled: Some(true),
                source_lang: Some("EN".to_string()),
                target_lang: Some("zh-cn".to_string()),
                q: Some("physics".to_string()),
            },
        );

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].glossary_id, "glossary-1");
    }

    #[test]
    fn resolve_task_glossary_request_rejects_merged_entries_over_limit() {
        let state = test_state();
        let resource_entries = (0..MAX_GLOSSARY_ENTRIES)
            .map(|index| entry(&format!("term-{index}"), &format!("词-{index}")))
            .collect();
        let glossary = create_glossary(
            state.db.as_ref(),
            &GlossaryUpsertInput {
                glossary_id: String::new(),
                name: "large".to_string(),
                description: String::new(),
                source_lang: "en".to_string(),
                target_lang: "zh-CN".to_string(),
                enabled: true,
                entries: resource_entries,
            },
        )
        .expect("create glossary");

        let mut input = CreateJobInput::default();
        input.translation.glossary_id = glossary.glossary_id;
        input.translation.glossary_entries = vec![entry("extra-term", "额外词")];

        let err =
            resolve_task_glossary_request(state.db.as_ref(), &input).expect_err("should reject");
        assert!(err
            .to_string()
            .contains("merged glossary entry count exceeds"));
    }
}
