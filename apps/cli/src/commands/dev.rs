use crate::cli::{Cli, DeployArgs, TargetArgs};
use crate::commands::{abi, activity, build, deploy, detect, interact, target, trace, tx, write};
use crate::config;
use crate::diagnostics;
use crate::error::{AppError, AppResult};
use crate::i18n::{t, tf};
use crate::output::{self, AccountMeta, Meta, NetworkMeta};
use chrono::{Local, TimeZone};
use crossterm::event::{
    self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent, KeyModifiers,
    MouseEvent, MouseEventKind,
};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout, Margin, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, Borders, Clear, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState, Tabs, Wrap,
};
use ratatui::{Frame, Terminal};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{self, Stdout, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
struct DevData {
    target: Option<String>,
    current_file: Option<String>,
    contract: Option<String>,
    contracts: Vec<DevContract>,
    source_explorer: DevSourceExplorer,
    source_mode: String,
    project_root: Option<String>,
    network: NetworkMeta,
    account: AccountMeta,
    tools: DevTools,
    deployment: PanelStatus,
    state: DevStatePanel,
    events: DevEventsPanel,
    functions: DevFunctionsPanel,
    diagnostics: DevDiagnosticsPanel,
    commands: Vec<DevCommand>,
    activity: Option<activity::ActivityData>,
    feed: Vec<DevFeedEvent>,
    transactions: Vec<tx::TransactionRecord>,
    panels: Vec<String>,
    keymap: Vec<KeyHint>,
}

#[derive(Debug, Clone, Serialize)]
struct DevTools {
    forge: String,
    cast: String,
    anvil: String,
}

#[derive(Debug, Clone, Serialize)]
struct PanelStatus {
    status: String,
    message: Option<String>,
    hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DevStatePanel {
    status: PanelStatus,
    address: Option<String>,
    values: Vec<DevStateValue>,
}

#[derive(Debug, Clone, Serialize)]
struct DevStateValue {
    name: String,
    signature: String,
    output_types: Vec<String>,
    readable: Option<String>,
    raw: String,
}

#[derive(Debug, Clone, Serialize)]
struct DevEventsPanel {
    status: PanelStatus,
    address: Option<String>,
    events: Vec<DevEvent>,
}

#[derive(Debug, Clone, Serialize)]
struct DevEvent {
    label: String,
    block_number: Option<u64>,
    transaction_hash: Option<String>,
    log_index: Option<u64>,
    args: Vec<DevEventArg>,
}

#[derive(Debug, Clone, Serialize)]
struct DevEventArg {
    name: String,
    kind: String,
    indexed: bool,
    value: String,
}

#[derive(Debug, Clone, Serialize)]
struct DevFunctionsPanel {
    status: PanelStatus,
    items: Vec<DevFunction>,
}

#[derive(Debug, Clone, Serialize)]
struct DevFunction {
    name: String,
    signature: String,
    mutability: String,
    kind: String,
    inputs: Vec<AbiParam>,
    outputs: Vec<AbiParam>,
}

#[derive(Debug, Clone, Serialize)]
struct AbiParam {
    name: String,
    kind: String,
}

#[derive(Debug, Clone, Serialize)]
struct DevContract {
    name: String,
    target: String,
    artifact_path: String,
}

#[derive(Debug, Clone, Serialize)]
struct DevSourceExplorer {
    status: PanelStatus,
    root: Option<String>,
    files: Vec<DevSourceFile>,
}

#[derive(Debug, Clone, Serialize)]
struct DevSourceFile {
    path: String,
    absolute_path: String,
    category: String,
    contracts: Vec<DevSourceContract>,
}

#[derive(Debug, Clone, Serialize)]
struct DevSourceContract {
    name: String,
    kind: String,
    target: String,
    deployable: bool,
}

#[derive(Debug, Clone)]
struct SourceEntry {
    file_path: String,
    contract_name: Option<String>,
    contract_kind: Option<String>,
    target: Option<String>,
    search_text: String,
}

#[derive(Debug, Clone, Serialize)]
struct DevDiagnosticsPanel {
    status: PanelStatus,
    diagnostics: Vec<build::Diagnostic>,
    stdout: Option<String>,
    stderr: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DevCommand {
    label: String,
    command: String,
    description: String,
}

#[derive(Debug, Clone, Serialize)]
struct DevFeedEvent {
    level: String,
    message: String,
    created_at_unix: u64,
}

#[derive(Debug, Clone)]
struct DevTraceResult {
    tx_hash: String,
    network: String,
    block_number: Option<String>,
    status: Option<String>,
    gas_used: Option<String>,
    lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct KeyHint {
    key: String,
    action: String,
}

#[derive(Debug)]
struct DevApp {
    data: DevData,
    status: String,
    active_panel: usize,
    selected_contract: usize,
    selected_function: usize,
    selected_command: usize,
    last_function_result: Option<String>,
    picker: Option<ContractPicker>,
    input_cache: HashMap<String, String>,
    input_form: Option<ActionInputForm>,
    confirm_form: Option<ConfirmForm>,
    trace_result: Option<DevTraceResult>,
    activity_scroll: usize,
    focus: DevPaneFocus,
    scroll_events_since_log: usize,
    last_scroll_delta: isize,
    scroll_log_started: bool,
}

#[derive(Debug, Clone)]
struct ContractPicker {
    query: String,
    selected: usize,
}

#[derive(Debug, Clone)]
struct ActionInputForm {
    action: ActionKind,
    signature: String,
    prompt: String,
    params: Vec<AbiParam>,
    text: String,
    cache_key: Option<String>,
    output_types: Vec<String>,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct InputParamRow {
    index: usize,
    name: String,
    kind: String,
    format: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActionKind {
    Read,
    Write,
    Payable,
    Deploy,
}

#[derive(Debug, Clone)]
enum ConfirmForm {
    Send(SendConfirmForm),
    Deploy(DeployConfirmForm),
}

#[derive(Debug, Clone)]
struct SendConfirmForm {
    target: String,
    signature: String,
    args: Vec<String>,
    value: Option<String>,
    address: String,
    network: String,
    chain_id: Option<u64>,
    write_policy: String,
    account: String,
    gas_estimate: Option<String>,
    signer_address: Option<String>,
    nonce: Option<String>,
    gas_price: Option<String>,
    calldata_hash: Option<String>,
    calldata_prefix: Option<String>,
    confirmation_expected: Option<String>,
    confirmation_input: String,
}

#[derive(Debug, Clone)]
struct DeployConfirmForm {
    target: String,
    contract: String,
    args: Vec<String>,
    network: String,
    chain_id: Option<u64>,
    write_policy: String,
    account: String,
    signer_address: Option<String>,
    nonce: Option<String>,
    gas_price: Option<String>,
    confirmation_expected: Option<String>,
    confirmation_input: String,
}

const PANEL_TITLES: [&str; 7] = [
    "Overview", "State", "Events", "Contract", "Build", "Activity", "Help",
];
const STATUS_PANEL_INDEX: usize = 0;
const STATE_PANEL_INDEX: usize = 1;
const EVENTS_PANEL_INDEX: usize = 2;
const FUNCTIONS_PANEL_INDEX: usize = 3;
const DIAGNOSTICS_PANEL_INDEX: usize = 4;
const FEED_PANEL_INDEX: usize = 5;
const COMMANDS_PANEL_INDEX: usize = 6;
const LIVE_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const USER_INTERACTION_REFRESH_DELAY: Duration = Duration::from_millis(800);
const MAX_FEED_EVENTS: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DevLayoutMode {
    Wide,
    Short,
    Narrow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DevPaneFocus {
    Main,
    ContractFunctions,
    ContractState,
    ContractActivity,
    Activity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CommandAction {
    Build,
    Deploy,
    State,
    Events,
    Feed,
    Copy,
}

pub fn run(cli: &Cli, args: &TargetArgs) -> AppResult<()> {
    let data = load_data(cli, args)?;
    if cli.json {
        let mut meta = Meta::new("dev");
        meta.project_root = data.project_root.clone();
        meta.network = Some(data.network.clone());
        meta.account = Some(data.account.clone());
        return output::print_json(data, meta);
    }

    run_tui(cli, args, data)
}

fn run_tui(cli: &Cli, args: &TargetArgs, data: DevData) -> AppResult<()> {
    let log_path = diagnostics::dev_log_path();
    let _ = diagnostics::append_dev_log(
        "info",
        &format!(
            "dev session starting; target={}; log={}",
            args.target.as_deref().unwrap_or("<auto>"),
            log_path.display()
        ),
    );
    let mut terminal = setup_terminal()?;
    let _guard = TerminalGuard::new();
    let mut app = DevApp {
        data,
        status: format!("ready; log {}", log_path.display()),
        active_panel: 0,
        selected_contract: 0,
        selected_function: 0,
        selected_command: 0,
        last_function_result: None,
        picker: None,
        input_cache: HashMap::new(),
        input_form: None,
        confirm_form: None,
        trace_result: None,
        activity_scroll: 0,
        focus: DevPaneFocus::Main,
        scroll_events_since_log: 0,
        last_scroll_delta: 0,
        scroll_log_started: false,
    };
    clamp_selected_contract(&mut app);
    if app.data.target.is_some() {
        set_active_panel(&mut app, FUNCTIONS_PANEL_INDEX);
    }
    maybe_open_initial_picker(args, &mut app);
    let mut last_auto_refresh = Instant::now();
    let mut last_user_interaction = Instant::now();

    let exit_reason = loop {
        if let Err(err) = terminal.draw(|frame| render(frame, &app)) {
            let reason = format!("terminal draw failed: {err}");
            let _ = diagnostics::append_dev_log("error", &reason);
            return Err(err.into());
        }

        let has_event = match event::poll(Duration::from_millis(250)) {
            Ok(has_event) => has_event,
            Err(err) => {
                let reason = format!("terminal event poll failed: {err}");
                let _ = diagnostics::append_dev_log("error", &reason);
                return Err(err.into());
            }
        };
        if !has_event {
            if last_auto_refresh.elapsed() >= LIVE_REFRESH_INTERVAL
                && last_user_interaction.elapsed() >= USER_INTERACTION_REFRESH_DELAY
            {
                auto_refresh_live_data(cli, args, &mut app);
                last_auto_refresh = Instant::now();
            }
            continue;
        }
        last_user_interaction = Instant::now();

        let modal_active =
            app.input_form.is_some() || app.confirm_form.is_some() || app.picker.is_some();
        let event = match event::read() {
            Ok(event) => event,
            Err(err) => {
                let reason = format!("terminal event read failed: {err}");
                let _ = diagnostics::append_dev_log("error", &reason);
                return Err(err.into());
            }
        };
        match event {
            Event::Key(key) => {
                if should_quit(key, modal_active) {
                    let reason = quit_reason(key);
                    let _ = diagnostics::append_dev_log("info", &reason);
                    break reason;
                }
                handle_key(key, cli, args, &mut app);
            }
            Event::Mouse(mouse) if !modal_active => {
                let area = terminal
                    .size()
                    .map(|size| Rect::new(0, 0, size.width, size.height))
                    .unwrap_or_else(|_| Rect::new(0, 0, 0, 0));
                handle_mouse(mouse, area, &mut app);
            }
            Event::Resize(width, height) => {
                let _ = diagnostics::append_dev_log(
                    "debug",
                    &format!("terminal resized {width}x{height}"),
                );
            }
            _ => {}
        }
    };

    let _ = diagnostics::append_dev_log("info", &format!("dev session exiting: {exit_reason}"));
    Ok(())
}

fn handle_key(key: KeyEvent, cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    if app.confirm_form.is_some() {
        handle_confirm_key(key, cli, args, app);
        return;
    }
    if app.picker.is_some() {
        handle_picker_key(key, cli, args, app);
        return;
    }
    if app.input_form.is_some() {
        handle_input_key(key, cli, args, app);
        return;
    }

    match key.code {
        KeyCode::Tab => {
            cycle_pane_focus(app);
            app.status = format!("focus: {}", pane_focus_label(app.focus));
        }
        KeyCode::BackTab => {
            let next = (app.active_panel + 1) % app.data.panels.len();
            set_active_panel(app, next);
            app.status = format!("panel: {}", app.data.panels[app.active_panel]);
        }
        KeyCode::Char(ch) if ('1'..='9').contains(&ch) => {
            let index = ch as usize - '1' as usize;
            if index < app.data.panels.len() {
                set_active_panel(app, index);
                app.status = format!("panel: {}", app.data.panels[app.active_panel]);
            }
        }
        KeyCode::Char('/') => {
            open_contract_picker(app);
        }
        KeyCode::Char('r') => match load_data_with_target(cli, args, app.data.target.clone()) {
            Ok(data) => {
                replace_data_preserving_feed(app, data);
                app.activity_scroll = 0;
                let active_panel = app.active_panel.min(app.data.panels.len() - 1);
                set_active_panel(app, active_panel);
                clamp_selected_contract(app);
                clamp_selected_function(app);
                clamp_selected_command(app);
                app.status = "refreshed".to_string();
                push_feed(
                    app,
                    DevFeedEvent::info(format!("manual refresh #{}", app.data.feed.len() + 1)),
                );
            }
            Err(err) => {
                app.status = format!("refresh failed: {}", err.message());
                push_feed(
                    app,
                    DevFeedEvent::error(format!("refresh failed: {}", err.message())),
                );
            }
        },
        KeyCode::Char('n') => {
            switch_network_in_tui(cli, args, app);
        }
        KeyCode::Char('a') => {
            switch_account_in_tui(cli, args, app);
        }
        KeyCode::Char(']') => {
            switch_contract_in_tui(cli, args, app, 1);
        }
        KeyCode::Char('[') => {
            switch_contract_in_tui(cli, args, app, -1);
        }
        KeyCode::Down if contract_functions_focused(app) => {
            move_selected_function(app, 1);
        }
        KeyCode::Up if contract_functions_focused(app) => {
            move_selected_function(app, -1);
        }
        KeyCode::Down if app.active_panel == COMMANDS_PANEL_INDEX => {
            move_selected_command(app, 1);
        }
        KeyCode::Up if app.active_panel == COMMANDS_PANEL_INDEX => {
            move_selected_command(app, -1);
        }
        KeyCode::Enter | KeyCode::Char('c') if contract_functions_focused(app) => {
            call_selected_function(cli, args, app);
        }
        KeyCode::Char('y') if contract_functions_focused(app) => {
            copy_selected_function_command(args, app);
        }
        KeyCode::Enter if app.active_panel == COMMANDS_PANEL_INDEX => {
            run_selected_command_action(cli, args, app);
        }
        KeyCode::Char('y') if app.active_panel == COMMANDS_PANEL_INDEX => {
            copy_selected_command(app);
        }
        KeyCode::Char('t') if app.active_panel == FEED_PANEL_INDEX => {
            trace_latest_transaction_in_tui(cli, app);
        }
        KeyCode::PageUp if activity_focused(app) => scroll_activity(app, 4, "page-up"),
        KeyCode::PageDown if activity_focused(app) => scroll_activity(app, -4, "page-down"),
        KeyCode::Char('d') => {
            start_deploy_action(cli, args, app);
        }
        KeyCode::Char('b') => {
            run_build_in_tui(cli, args, app);
        }
        KeyCode::Esc => {
            app.status = "Esc closes pickers and action sheets; press q to quit".to_string();
        }
        _ => {}
    }
}

fn handle_mouse(mouse: MouseEvent, terminal_area: Rect, app: &mut DevApp) {
    match mouse.kind {
        MouseEventKind::Down(_) => {
            if let Some(focus) = pane_focus_at(app, terminal_area, mouse.column, mouse.row) {
                app.focus = focus;
                app.status = format!("focus: {}", pane_focus_label(app.focus));
                let _ = diagnostics::append_dev_log(
                    "debug",
                    &format!("pane focused by mouse: {}", pane_focus_label(app.focus)),
                );
            }
        }
        MouseEventKind::ScrollUp => handle_mouse_scroll(mouse, terminal_area, app, 3),
        MouseEventKind::ScrollDown => handle_mouse_scroll(mouse, terminal_area, app, -3),
        _ => {}
    }
}

fn handle_mouse_scroll(mouse: MouseEvent, terminal_area: Rect, app: &mut DevApp, delta: isize) {
    let Some(focus) = pane_focus_at(app, terminal_area, mouse.column, mouse.row) else {
        log_scroll_activity(app, delta, "mouse-wheel", "ignored-outside-pane");
        return;
    };
    if app.focus != focus {
        app.focus = focus;
        app.status = format!("focus: {}", pane_focus_label(app.focus));
    }
    if !activity_focused(app) {
        log_scroll_activity(app, delta, "mouse-wheel", "ignored-non-activity-focus");
        return;
    }

    let source = if delta.is_negative() {
        "mouse-wheel-down"
    } else {
        "mouse-wheel-up"
    };
    scroll_activity(app, delta, source);
}

fn scroll_activity(app: &mut DevApp, delta: isize, source: &str) {
    if !activity_focused(app) {
        log_scroll_activity(app, delta, source, "ignored-inactive-panel");
        return;
    }
    let max_offset = activity_log_row_count(&app.data)
        .saturating_mul(20)
        .saturating_sub(1);
    let previous = app.activity_scroll;
    app.activity_scroll = next_activity_scroll(app.activity_scroll, delta, max_offset);
    app.status = if app.activity_scroll == 0 {
        "activity: latest entries".to_string()
    } else {
        format!("activity: {} row(s) older", app.activity_scroll)
    };
    let state = if previous == app.activity_scroll {
        "unchanged"
    } else {
        "updated"
    };
    log_scroll_activity(app, delta, source, state);
}

fn log_scroll_activity(app: &mut DevApp, delta: isize, source: &str, state: &str) {
    app.scroll_events_since_log = app.scroll_events_since_log.saturating_add(1);
    app.last_scroll_delta = delta;

    let should_log = !app.scroll_log_started || app.scroll_events_since_log >= 12;
    if !should_log {
        return;
    }

    let total_rows = activity_log_rows(&app.data, 80).len();
    let message = format!(
        "activity scroll source={source} state={state} events={} delta={} last_delta={} panel={} offset={} rows={total_rows}",
        app.scroll_events_since_log,
        delta,
        app.last_scroll_delta,
        app.data
            .panels
            .get(app.active_panel)
            .map(String::as_str)
            .unwrap_or("<unknown>"),
        app.activity_scroll,
    );
    let _ = diagnostics::append_dev_log("debug", &message);
    app.scroll_log_started = true;
    app.scroll_events_since_log = 0;
}

fn next_activity_scroll(current: usize, delta: isize, max_offset: usize) -> usize {
    if delta.is_negative() {
        current.saturating_sub(delta.unsigned_abs())
    } else {
        current.saturating_add(delta as usize).min(max_offset)
    }
}

fn set_active_panel(app: &mut DevApp, panel_index: usize) {
    let max_index = app.data.panels.len().saturating_sub(1);
    let panel_index = panel_index.min(max_index);
    app.active_panel = panel_index;
    app.focus = default_focus_for_panel(panel_index);
}

fn default_focus_for_panel(panel_index: usize) -> DevPaneFocus {
    match panel_index {
        FUNCTIONS_PANEL_INDEX => DevPaneFocus::ContractFunctions,
        FEED_PANEL_INDEX => DevPaneFocus::Activity,
        _ => DevPaneFocus::Main,
    }
}

fn cycle_pane_focus(app: &mut DevApp) {
    app.focus = match app.active_panel {
        FUNCTIONS_PANEL_INDEX => match app.focus {
            DevPaneFocus::ContractFunctions => DevPaneFocus::ContractState,
            DevPaneFocus::ContractState => DevPaneFocus::ContractActivity,
            DevPaneFocus::ContractActivity => DevPaneFocus::ContractFunctions,
            _ => DevPaneFocus::ContractFunctions,
        },
        FEED_PANEL_INDEX => DevPaneFocus::Activity,
        _ => DevPaneFocus::Main,
    };
}

fn contract_functions_focused(app: &DevApp) -> bool {
    app.active_panel == FUNCTIONS_PANEL_INDEX && app.focus == DevPaneFocus::ContractFunctions
}

fn activity_focused(app: &DevApp) -> bool {
    matches!(
        (app.active_panel, app.focus),
        (FUNCTIONS_PANEL_INDEX, DevPaneFocus::ContractActivity)
            | (FEED_PANEL_INDEX, DevPaneFocus::Activity)
    )
}

fn pane_focus_label(focus: DevPaneFocus) -> &'static str {
    match focus {
        DevPaneFocus::Main => "main",
        DevPaneFocus::ContractFunctions => "contract functions",
        DevPaneFocus::ContractState => "state watch",
        DevPaneFocus::ContractActivity => "activity",
        DevPaneFocus::Activity => "activity",
    }
}

fn pane_focus_at(app: &DevApp, terminal_area: Rect, column: u16, row: u16) -> Option<DevPaneFocus> {
    let panel_area = active_panel_area(terminal_area);
    if !rect_contains(panel_area, column, row) {
        return None;
    }
    match app.active_panel {
        FUNCTIONS_PANEL_INDEX => contract_pane_focus_at(panel_area, column, row),
        FEED_PANEL_INDEX => Some(DevPaneFocus::Activity),
        _ => Some(DevPaneFocus::Main),
    }
}

fn active_panel_area(area: Rect) -> Rect {
    let mode = dev_layout_mode(area);
    let header_height = if mode == DevLayoutMode::Short { 4 } else { 5 };
    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(header_height),
            Constraint::Min(8),
            Constraint::Length(3),
        ])
        .split(area);
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(8)])
        .split(root[1]);
    rows[1]
}

fn contract_pane_focus_at(area: Rect, column: u16, row: u16) -> Option<DevPaneFocus> {
    if area.height < 14 {
        return Some(DevPaneFocus::ContractFunctions);
    }

    if area.width >= 108 {
        let state_log_width = ((area.width as f32 * 0.44) as u16).clamp(44, 76);
        let columns = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(50), Constraint::Length(state_log_width)])
            .split(area);
        let right = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(54), Constraint::Percentage(46)])
            .split(columns[1]);
        if rect_contains(columns[0], column, row) {
            return Some(DevPaneFocus::ContractFunctions);
        }
        if rect_contains(right[0], column, row) {
            return Some(DevPaneFocus::ContractState);
        }
        if rect_contains(right[1], column, row) {
            return Some(DevPaneFocus::ContractActivity);
        }
        return None;
    }

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(58), Constraint::Percentage(42)])
        .split(area);
    if rect_contains(rows[0], column, row) {
        return Some(DevPaneFocus::ContractFunctions);
    }

    if rows[1].width >= 88 && rows[1].height >= 7 {
        let lower = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(rows[1]);
        if rect_contains(lower[0], column, row) {
            return Some(DevPaneFocus::ContractState);
        }
        if rect_contains(lower[1], column, row) {
            return Some(DevPaneFocus::ContractActivity);
        }
    } else if rect_contains(rows[1], column, row) {
        return Some(DevPaneFocus::ContractState);
    }

    None
}

fn rect_contains(rect: Rect, column: u16, row: u16) -> bool {
    column >= rect.x
        && column < rect.x.saturating_add(rect.width)
        && row >= rect.y
        && row < rect.y.saturating_add(rect.height)
}

fn move_selected_function(app: &mut DevApp, delta: isize) {
    let count = app.data.functions.items.len();
    if count == 0 {
        app.selected_function = 0;
        app.status = "no functions".to_string();
        return;
    }
    app.selected_function = if delta.is_negative() {
        app.selected_function.saturating_sub(delta.unsigned_abs())
    } else {
        (app.selected_function + delta as usize).min(count - 1)
    };
    app.status = format!(
        "selected {}",
        app.data.functions.items[app.selected_function].signature
    );
}

fn clamp_selected_function(app: &mut DevApp) {
    let count = app.data.functions.items.len();
    app.selected_function = if count == 0 {
        0
    } else {
        app.selected_function.min(count - 1)
    };
}

fn clamp_selected_contract(app: &mut DevApp) {
    let count = app.data.contracts.len();
    app.selected_contract = if count == 0 {
        0
    } else if let Some(target) = app.data.target.as_deref() {
        app.data
            .contracts
            .iter()
            .position(|contract| contract.target == target)
            .unwrap_or(app.selected_contract.min(count - 1))
    } else {
        app.selected_contract.min(count - 1)
    };
}

fn maybe_open_initial_picker(args: &TargetArgs, app: &mut DevApp) {
    if args.target.is_some() || app.data.target.is_some() {
        return;
    }
    if contract_picker_entries(&app.data.source_explorer, "").len() > 1 {
        open_contract_picker(app);
        app.status = "select a contract to start".to_string();
    }
}

fn open_contract_picker(app: &mut DevApp) {
    let mut picker = ContractPicker {
        query: String::new(),
        selected: 0,
    };
    if let Some(target) = app.data.target.as_deref() {
        if let Some(index) = contract_picker_entries(&app.data.source_explorer, "")
            .iter()
            .position(|entry| entry.target.as_deref() == Some(target))
        {
            picker.selected = index;
        }
    }
    app.picker = Some(picker);
    app.status = "contract picker".to_string();
}

fn handle_picker_key(key: KeyEvent, cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    match key.code {
        KeyCode::Esc => {
            app.picker = None;
            app.status = "contract picker closed".to_string();
        }
        KeyCode::Enter => open_selected_picker_contract(cli, args, app),
        _ if picker_move_delta(key).is_some() => {
            if let Some(delta) = picker_move_delta(key) {
                move_picker_selection(app, delta);
            }
        }
        KeyCode::Backspace => {
            if let Some(picker) = &mut app.picker {
                picker.query.pop();
                picker.selected = 0;
            }
        }
        _ if picker_text_char(key).is_some() => {
            if let Some(picker) = &mut app.picker {
                let ch = picker_text_char(key).unwrap_or_default();
                picker.query.push(ch);
                picker.selected = 0;
            }
        }
        _ => {}
    }
}

fn picker_move_delta(key: KeyEvent) -> Option<isize> {
    match key.code {
        KeyCode::Down => Some(1),
        KeyCode::Up => Some(-1),
        _ => None,
    }
}

fn picker_text_char(key: KeyEvent) -> Option<char> {
    match key.code {
        KeyCode::Char(ch) if key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT => {
            Some(ch)
        }
        _ => None,
    }
}

fn move_picker_selection(app: &mut DevApp, delta: isize) {
    let Some(picker) = &app.picker else {
        return;
    };
    let count = contract_picker_entries(&app.data.source_explorer, &picker.query).len();
    if count == 0 {
        if let Some(picker) = &mut app.picker {
            picker.selected = 0;
        }
        app.status = "no matching contract".to_string();
        return;
    }
    if let Some(picker) = &mut app.picker {
        picker.selected = if delta.is_negative() {
            picker.selected.saturating_sub(delta.unsigned_abs())
        } else {
            (picker.selected + delta as usize).min(count - 1)
        };
    }
}

fn open_selected_picker_contract(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(picker) = &app.picker else {
        return;
    };
    let entries = contract_picker_entries(&app.data.source_explorer, &picker.query);
    let Some(entry) = entries.get(picker.selected).cloned() else {
        app.status = "no matching contract".to_string();
        return;
    };
    let Some(target) = entry.target else {
        app.status = "selected entry has no contract target".to_string();
        return;
    };
    match load_data_with_target(cli, args, Some(target.clone())) {
        Ok(data) => {
            replace_data_preserving_feed(app, data);
            clamp_selected_contract(app);
            clamp_selected_function(app);
            clamp_selected_command(app);
            set_active_panel(app, FUNCTIONS_PANEL_INDEX);
            app.picker = None;
            app.last_function_result = None;
            app.status = entry.contract_name.as_ref().map_or_else(
                || format!("opened {target}"),
                |contract| format!("opened {contract}"),
            );
            push_feed(app, DevFeedEvent::info(app.status.clone()));
        }
        Err(err) => {
            app.status = format!("open contract failed: {}", err.message());
            app.last_function_result = error_result(&err);
            push_feed(app, DevFeedEvent::error(app.status.clone()));
        }
    }
}

fn move_selected_command(app: &mut DevApp, delta: isize) {
    let count = app.data.commands.len();
    if count == 0 {
        app.selected_command = 0;
        app.status = "no commands".to_string();
        return;
    }
    app.selected_command = if delta.is_negative() {
        app.selected_command.saturating_sub(delta.unsigned_abs())
    } else {
        (app.selected_command + delta as usize).min(count - 1)
    };
    app.status = format!(
        "selected command: {}",
        app.data.commands[app.selected_command].label
    );
}

fn current_target(args: &TargetArgs, app: &DevApp) -> Option<String> {
    app.data.target.clone().or_else(|| args.target.clone())
}

fn push_feed(app: &mut DevApp, event: DevFeedEvent) {
    let _ = diagnostics::append_dev_log(&event.level, &event.message);
    app.data.feed.push(event);
    app.activity_scroll = 0;
    if app.data.feed.len() > MAX_FEED_EVENTS {
        let overflow = app.data.feed.len() - MAX_FEED_EVENTS;
        app.data.feed.drain(0..overflow);
    }
}

fn replace_data_preserving_feed(app: &mut DevApp, mut data: DevData) {
    data.feed = app.data.feed.clone();
    app.data = data;
    app.trace_result = None;
}

fn clamp_selected_command(app: &mut DevApp) {
    let count = app.data.commands.len();
    app.selected_command = if count == 0 {
        0
    } else {
        app.selected_command.min(count - 1)
    };
}

fn handle_input_key(key: KeyEvent, cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    match key.code {
        KeyCode::Esc => {
            app.input_form = None;
            app.status = "input cancelled".to_string();
        }
        KeyCode::Enter => submit_input_form(cli, args, app),
        KeyCode::Backspace => {
            if let Some(form) = &mut app.input_form {
                form.text.pop();
                form.error = None;
            }
        }
        KeyCode::Char(ch) => {
            if let Some(form) = &mut app.input_form {
                form.text.push(ch);
                form.error = None;
            }
        }
        _ => {}
    }
}

fn call_selected_function(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(target_value) = current_target(args, app) else {
        app.status = "open a target first".to_string();
        return;
    };
    let Some(function) = app.data.functions.items.get(app.selected_function) else {
        app.status = "no function selected".to_string();
        return;
    };
    let signature = function.signature.clone();
    if function.kind == "constructor" {
        start_deploy_action(cli, args, app);
        return;
    }
    if function_needs_deployment(&app.data, function) {
        open_deploy_before_function(cli, args, app, &signature);
        return;
    }
    if function.kind == "payable" || !function.inputs.is_empty() {
        let action = match function.kind.as_str() {
            "read" => ActionKind::Read,
            "payable" => ActionKind::Payable,
            _ => ActionKind::Write,
        };
        let cache_key = input_cache_key(&target_value, action, &signature);
        let text = app.input_cache.get(&cache_key).cloned().unwrap_or_default();
        app.status = format!("input args for {signature}");
        app.input_form = Some(ActionInputForm {
            action,
            signature: signature.clone(),
            prompt: function_input_prompt(function),
            params: function.inputs.clone(),
            text,
            cache_key: Some(cache_key),
            output_types: function_output_types(function),
            error: None,
        });
        return;
    }

    if function.kind == "read" {
        call_function_with_args(
            cli,
            args,
            &target_value,
            app,
            &signature,
            Vec::new(),
            &function_output_types(function),
        );
    } else {
        prepare_send_confirmation(cli, args, &target_value, app, &signature, Vec::new(), None);
    }
}

fn function_needs_deployment(data: &DevData, function: &DevFunction) -> bool {
    function.kind != "constructor" && data.deployment.status != "ready"
}

fn open_deploy_before_function(cli: &Cli, args: &TargetArgs, app: &mut DevApp, signature: &str) {
    let contract = app.data.contract.as_deref().unwrap_or("this contract");
    let message = format!("No deployment for {contract}. Deploy it first, then run {signature}.");
    start_deploy_action(cli, args, app);
    if app.confirm_form.is_some()
        || app
            .input_form
            .as_ref()
            .is_some_and(|form| form.action == ActionKind::Deploy)
    {
        app.status = format!("{signature} needs deployment; deploy preview opened");
        app.last_function_result = Some(message.clone());
        push_feed(app, DevFeedEvent::warn(message));
    }
}

fn copy_selected_function_command(args: &TargetArgs, app: &mut DevApp) {
    let Some(target_value) = current_target(args, app) else {
        app.status = "open a target first".to_string();
        return;
    };
    let Some(function) = app.data.functions.items.get(app.selected_function) else {
        app.status = "no function selected".to_string();
        return;
    };
    let command = function_cli_command(&target_value, function);
    copy_command(app, &command);
}

fn copy_selected_command(app: &mut DevApp) {
    let Some(command) = app.data.commands.get(app.selected_command) else {
        app.status = "no command selected".to_string();
        return;
    };
    let command = command.command.clone();
    copy_command(app, &command);
}

fn run_selected_command_action(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(command) = app.data.commands.get(app.selected_command) else {
        app.status = "no action selected".to_string();
        return;
    };
    match command_action(&command.label) {
        CommandAction::Build => run_build_in_tui(cli, args, app),
        CommandAction::Deploy => start_deploy_action(cli, args, app),
        CommandAction::State => {
            set_active_panel(app, STATE_PANEL_INDEX);
            app.status = "state shows zero-arg read values; press r to refresh".to_string();
        }
        CommandAction::Events => {
            set_active_panel(app, EVENTS_PANEL_INDEX);
            app.status = "events shows decoded logs for this deployment".to_string();
        }
        CommandAction::Feed => {
            set_active_panel(app, FEED_PANEL_INDEX);
            app.status = "activity shows session, tx, and event history; press t to trace latest"
                .to_string();
        }
        CommandAction::Copy => {
            let label = command.label.clone();
            copy_selected_command(app);
            app.status = format!("{label} is a CLI-only action; copied command");
        }
    }
}

fn command_action(label: &str) -> CommandAction {
    match label {
        "build" => CommandAction::Build,
        "deploy" => CommandAction::Deploy,
        "state" => CommandAction::State,
        "logs" => CommandAction::Events,
        "activity" => CommandAction::Feed,
        "tx list" => CommandAction::Feed,
        _ => CommandAction::Copy,
    }
}

fn copy_command(app: &mut DevApp, command: &str) {
    match copy_text_to_clipboard(command) {
        Ok(backend) => {
            app.status = format!("copied command via {backend}");
            app.last_function_result = Some(command.to_string());
            push_feed(app, DevFeedEvent::info(app.status.clone()));
        }
        Err(err) => {
            app.status = format!("copy failed: {}", err.message());
            app.last_function_result = Some(format!(
                "{}\nCommand: {}",
                err.hint()
                    .unwrap_or_else(|| "Copy the command manually.".to_string()),
                command
            ));
            push_feed(app, DevFeedEvent::warn(app.status.clone()));
        }
    }
}

fn submit_input_form(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(target_value) = current_target(args, app) else {
        app.input_form = None;
        app.status = "open a target first".to_string();
        return;
    };
    let Some(mut form) = app.input_form.take() else {
        return;
    };
    form.error = None;
    let function_args = match shell_words(&form.text) {
        Ok(args) => args,
        Err(err) => {
            keep_input_form_error(
                app,
                form,
                &t("input-args-parse-error"),
                format!("{err}\n{}", t("input-args-parse-help")),
            );
            return;
        }
    };
    let expected_count = expected_input_count(&form);
    if function_args.len() != expected_count {
        let message = input_arg_count_message(&form, function_args.len());
        keep_input_form_error(app, form, &t("input-args-count-error"), message);
        return;
    }
    let (value, call_args) = if form.action == ActionKind::Payable {
        split_payable_input(function_args)
    } else {
        (None, function_args)
    };
    if let Err(err) = validate_action_args(&form, value.as_deref(), &call_args) {
        keep_input_form_error(
            app,
            form,
            &t("input-args-validate-error"),
            error_result(&err).unwrap_or_else(|| err.message()),
        );
        return;
    }
    if let Some(cache_key) = &form.cache_key {
        app.input_cache.insert(cache_key.clone(), form.text.clone());
    }
    if form.action != ActionKind::Deploy && app.data.deployment.status != "ready" {
        open_deploy_before_function(cli, args, app, &form.signature);
        return;
    }
    match form.action {
        ActionKind::Read => {
            call_function_with_args(
                cli,
                args,
                &target_value,
                app,
                &form.signature,
                call_args,
                &form.output_types,
            );
        }
        ActionKind::Write => {
            prepare_send_confirmation(
                cli,
                args,
                &target_value,
                app,
                &form.signature,
                call_args,
                None,
            );
        }
        ActionKind::Payable => {
            prepare_send_confirmation(
                cli,
                args,
                &target_value,
                app,
                &form.signature,
                call_args,
                value,
            );
        }
        ActionKind::Deploy => {
            prepare_deploy_confirmation(cli, &target_value, app, call_args);
        }
    }
}

fn keep_input_form_error(
    app: &mut DevApp,
    mut form: ActionInputForm,
    status: &str,
    message: String,
) {
    form.error = Some(message.clone());
    app.status = status.to_string();
    app.last_function_result = Some(message);
    app.input_form = Some(form);
}

fn input_cache_key(target: &str, action: ActionKind, signature: &str) -> String {
    format!(
        "{}\u{1f}{}\u{1f}{}",
        target,
        action.cache_label(),
        signature
    )
}

fn expected_input_count(form: &ActionInputForm) -> usize {
    form.params.len() + usize::from(form.action == ActionKind::Payable)
}

fn input_arg_count_message(form: &ActionInputForm, actual: usize) -> String {
    let expected = expected_input_count(form);
    let labels = input_param_rows(form)
        .into_iter()
        .map(|row| format!("{}. {} {}", row.index, row.name, row.kind))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{} expects {expected} arg(s), got {actual}. Enter values in this order: {labels}",
        form.signature
    )
}

fn validate_action_args(
    form: &ActionInputForm,
    value: Option<&str>,
    function_args: &[String],
) -> AppResult<()> {
    if form.action == ActionKind::Payable {
        validate_wei_value(value.unwrap_or("0")).map_err(|message| {
            AppError::user(
                "invalid_payable_value",
                "Invalid payable value.",
                Some(message),
            )
        })?;
    }
    match form.action {
        ActionKind::Read | ActionKind::Write | ActionKind::Payable => {
            interact::encode_calldata_checked(&form.signature, function_args)?;
        }
        ActionKind::Deploy => {
            let signature = constructor_signature(&form.params);
            interact::encode_constructor_args_checked(&signature, function_args)?;
        }
    }
    Ok(())
}

fn validate_wei_value(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if !trimmed.is_empty() && trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        return Ok(());
    }
    Err("msg.value is a wei amount. Use decimal digits only; do not add units like ether or gwei in this TUI field.".to_string())
}

fn call_function_with_args(
    cli: &Cli,
    args: &TargetArgs,
    target_value: &str,
    app: &mut DevApp,
    signature: &str,
    function_args: Vec<String>,
    output_types: &[String],
) {
    match interact::context(cli, target_value)
        .and_then(|context| interact::call_raw(&context, signature, &function_args))
    {
        Ok(raw) => {
            app.status = format!("called {signature}");
            let display = interact::decode_raw_abi_values(output_types, &raw)
                .filter(|values| !values.is_empty())
                .map(|values| values.join(", "))
                .unwrap_or_else(|| raw.clone());
            let result = if display == raw {
                format!("{signature} -> {raw}")
            } else {
                format!("{signature} -> {display} (raw {raw})")
            };
            app.last_function_result = Some(result.clone());
            push_feed(app, DevFeedEvent::info(format!("read {result}")));
        }
        Err(err) => {
            if err.code() == "deployment_not_found" {
                open_deploy_before_function(cli, args, app, signature);
                return;
            }
            app.status = format!("call failed: {}", err.message());
            app.last_function_result = err.hint().map_or_else(
                || Some(err.message()),
                |hint| Some(format!("{} Hint: {}", err.message(), hint)),
            );
            push_feed(app, DevFeedEvent::error(app.status.clone()));
        }
    }
}

fn start_deploy_action(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(target_value) = current_target(args, app) else {
        app.status = "open a target first".to_string();
        return;
    };

    match constructor_inputs(cli, &target_value) {
        Ok((contract, inputs)) => {
            if inputs.is_empty() {
                prepare_deploy_confirmation(cli, &target_value, app, Vec::new());
            } else {
                let signature = format!("deploy {contract}");
                let cache_key = input_cache_key(&target_value, ActionKind::Deploy, &signature);
                let text = app.input_cache.get(&cache_key).cloned().unwrap_or_default();
                app.status = format!("input constructor args for {contract}");
                app.input_form = Some(ActionInputForm {
                    action: ActionKind::Deploy,
                    signature,
                    prompt: format!("Constructor args: {}", params_label(&inputs)),
                    params: inputs,
                    text,
                    cache_key: Some(cache_key),
                    output_types: Vec::new(),
                    error: None,
                });
            }
        }
        Err(err) => {
            app.status = format!("deploy prep failed: {}", err.message());
            app.last_function_result = error_result(&err);
        }
    }
}

fn constructor_inputs(cli: &Cli, target_value: &str) -> AppResult<(String, Vec<AbiParam>)> {
    let resolved = target::resolve(cli, Some(target_value))?;
    let artifact: Value = target::with_scratch_lock(&resolved.project_root, || {
        deploy::run_forge_build(&resolved.project_root)?;
        let artifact_path = target::artifact_path(&resolved)?;
        Ok(serde_json::from_str(&fs::read_to_string(&artifact_path)?)?)
    })?;
    let inputs = abi_items(&artifact)
        .into_iter()
        .find(|item| item.get("type").and_then(Value::as_str) == Some("constructor"))
        .map_or_else(Vec::new, |item| abi_params(item, "inputs"));
    Ok((resolved.contract_name, inputs))
}

fn prepare_send_confirmation(
    cli: &Cli,
    args: &TargetArgs,
    target_value: &str,
    app: &mut DevApp,
    signature: &str,
    function_args: Vec<String>,
    value: Option<String>,
) {
    match interact::context(cli, target_value) {
        Ok(context) => {
            if let Err(err) = write::preflight_write_policy(cli, &context.network) {
                app.status = format!("send preview failed: {}", err.message());
                app.last_function_result = error_result(&err);
                return;
            }

            let signer = write::private_key_for_write(cli, &context.network, &context.account)
                .map(|(_, signer)| signer);
            let signer_address = match signer {
                Ok(signer_address) => signer_address,
                Err(err) => {
                    app.status = format!("send preview failed: {}", err.message());
                    app.last_function_result = error_result(&err);
                    return;
                }
            };
            let gas_estimate = interact::estimate_gas(
                &context.address,
                signature,
                &function_args,
                value.as_deref(),
                &context.network.rpc_url,
                Some(&signer_address),
            )
            .ok();
            let calldata = interact::encode_calldata(signature, &function_args);
            let details = write::preview_details(
                &context.network,
                Some(&signer_address),
                calldata.as_deref(),
            );

            app.status = format!("confirm send {signature}");
            app.confirm_form = Some(ConfirmForm::Send(SendConfirmForm {
                target: target_value.to_string(),
                signature: signature.to_string(),
                args: function_args,
                value,
                address: context.address,
                network: context.network.name.clone(),
                chain_id: context.network.chain_id,
                write_policy: context.network.write_policy.clone(),
                account: context.account.name.clone(),
                gas_estimate,
                signer_address: Some(signer_address),
                nonce: details.nonce,
                gas_price: details.gas_price,
                calldata_hash: details.calldata_hash,
                calldata_prefix: details.calldata_prefix,
                confirmation_expected: tui_confirmation_expected(&context.network),
                confirmation_input: String::new(),
            }));
        }
        Err(err) => {
            if err.code() == "deployment_not_found" {
                open_deploy_before_function(cli, args, app, signature);
                return;
            }
            app.status = format!("send preview failed: {}", err.message());
            app.last_function_result = error_result(&err);
        }
    }
}

fn prepare_deploy_confirmation(
    cli: &Cli,
    target_value: &str,
    app: &mut DevApp,
    constructor_args: Vec<String>,
) {
    let result = target::resolve(cli, Some(target_value)).and_then(|resolved| {
        let network = detect::active_network(cli)?;
        let account = detect::active_account(cli)?;
        Ok((resolved, network, account))
    });

    match result {
        Ok((resolved, network, account)) => {
            if let Err(err) = write::preflight_write_policy(cli, &network) {
                app.status = format!("deploy preview failed: {}", err.message());
                app.last_function_result = error_result(&err);
                return;
            }

            let signer =
                write::private_key_for_write(cli, &network, &account).map(|(_, signer)| signer);
            let signer_address = match signer {
                Ok(signer_address) => signer_address,
                Err(err) => {
                    app.status = format!("deploy preview failed: {}", err.message());
                    app.last_function_result = error_result(&err);
                    return;
                }
            };
            let details = write::preview_details(&network, Some(&signer_address), None);
            app.status = format!("confirm deploy {}", resolved.contract_name);
            app.confirm_form = Some(ConfirmForm::Deploy(DeployConfirmForm {
                target: target_value.to_string(),
                contract: resolved.contract_name,
                args: constructor_args,
                network: network.name.clone(),
                chain_id: network.chain_id,
                write_policy: network.write_policy.clone(),
                account: account.name.clone(),
                signer_address: Some(signer_address),
                nonce: details.nonce,
                gas_price: details.gas_price,
                confirmation_expected: tui_confirmation_expected(&network),
                confirmation_input: String::new(),
            }));
        }
        Err(err) => {
            app.status = format!("deploy preview failed: {}", err.message());
            app.last_function_result = error_result(&err);
        }
    }
}

fn tui_confirmation_expected(network: &NetworkMeta) -> Option<String> {
    match network.write_policy.as_str() {
        "local" => None,
        "confirm" => Some("yes".to_string()),
        "typed-confirm" => Some(network.name.clone()),
        _ => None,
    }
}

fn handle_confirm_key(key: KeyEvent, cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    if confirm_requires_typed_input(app.confirm_form.as_ref()) {
        handle_typed_confirm_key(key, cli, args, app);
        return;
    }

    match key.code {
        _ if local_confirm_key(key) => match app.confirm_form.as_ref() {
            Some(ConfirmForm::Send(_)) => send_confirmed_function(cli, args, app),
            Some(ConfirmForm::Deploy(_)) => deploy_confirmed_contract(cli, args, app),
            None => {}
        },
        KeyCode::Esc | KeyCode::Char('n') | KeyCode::Char('N') => {
            app.confirm_form = None;
            app.status = "action cancelled".to_string();
        }
        _ => {}
    }
}

fn local_confirm_key(key: KeyEvent) -> bool {
    matches!(
        key.code,
        KeyCode::Enter | KeyCode::Char('y') | KeyCode::Char('Y')
    )
}

fn confirm_requires_typed_input(form: Option<&ConfirmForm>) -> bool {
    match form {
        Some(ConfirmForm::Send(form)) => form.confirmation_expected.is_some(),
        Some(ConfirmForm::Deploy(form)) => form.confirmation_expected.is_some(),
        None => false,
    }
}

fn handle_typed_confirm_key(key: KeyEvent, cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    match key.code {
        KeyCode::Esc => {
            app.confirm_form = None;
            app.status = "action cancelled".to_string();
        }
        KeyCode::Backspace => {
            if let Some(input) = confirm_input_mut(app.confirm_form.as_mut()) {
                input.pop();
            }
        }
        KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            if let Some(input) = confirm_input_mut(app.confirm_form.as_mut()) {
                input.clear();
            }
        }
        KeyCode::Char(ch) if key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT => {
            if let Some(input) = confirm_input_mut(app.confirm_form.as_mut()) {
                input.push(ch);
            }
        }
        KeyCode::Enter => {
            if typed_confirmation_matches(app.confirm_form.as_ref()) {
                match app.confirm_form.as_ref() {
                    Some(ConfirmForm::Send(_)) => send_confirmed_function(cli, args, app),
                    Some(ConfirmForm::Deploy(_)) => deploy_confirmed_contract(cli, args, app),
                    None => {}
                }
            } else if let Some(expected) = confirm_expected(app.confirm_form.as_ref()) {
                app.status = format!("type `{expected}` to confirm");
                app.last_function_result = Some("remote confirmation did not match".to_string());
            }
        }
        _ => {}
    }
}

fn confirm_input_mut(form: Option<&mut ConfirmForm>) -> Option<&mut String> {
    match form {
        Some(ConfirmForm::Send(form)) => Some(&mut form.confirmation_input),
        Some(ConfirmForm::Deploy(form)) => Some(&mut form.confirmation_input),
        None => None,
    }
}

fn confirm_expected(form: Option<&ConfirmForm>) -> Option<&str> {
    match form {
        Some(ConfirmForm::Send(form)) => form.confirmation_expected.as_deref(),
        Some(ConfirmForm::Deploy(form)) => form.confirmation_expected.as_deref(),
        None => None,
    }
}

fn typed_confirmation_matches(form: Option<&ConfirmForm>) -> bool {
    match form {
        Some(ConfirmForm::Send(form)) => form
            .confirmation_expected
            .as_deref()
            .is_some_and(|expected| form.confirmation_input.trim() == expected),
        Some(ConfirmForm::Deploy(form)) => form
            .confirmation_expected
            .as_deref()
            .is_some_and(|expected| form.confirmation_input.trim() == expected),
        None => false,
    }
}

fn ensure_send_context_matches(
    form: &SendConfirmForm,
    context: &interact::Context,
) -> AppResult<()> {
    ensure_confirmation_field("network", &form.network, &context.network.name)?;
    ensure_confirmation_chain_id(form.chain_id, context.network.chain_id)?;
    ensure_confirmation_field(
        "write policy",
        &form.write_policy,
        &context.network.write_policy,
    )?;
    ensure_confirmation_field("account", &form.account, &context.account.name)?;
    ensure_confirmation_field("address", &form.address, &context.address)
}

fn ensure_deploy_network_matches(form: &DeployConfirmForm, network: &NetworkMeta) -> AppResult<()> {
    ensure_confirmation_field("network", &form.network, &network.name)?;
    ensure_confirmation_chain_id(form.chain_id, network.chain_id)?;
    ensure_confirmation_field("write policy", &form.write_policy, &network.write_policy)
}

fn ensure_deploy_account_matches(form: &DeployConfirmForm, account: &AccountMeta) -> AppResult<()> {
    ensure_confirmation_field("account", &form.account, &account.name)
}

fn ensure_signer_matches(expected: Option<&str>, actual: &str) -> AppResult<()> {
    match expected {
        Some(expected) => ensure_confirmation_field("signer", expected, actual),
        None => Ok(()),
    }
}

fn ensure_confirmation_field(label: &str, expected: &str, actual: &str) -> AppResult<()> {
    if expected == actual {
        return Ok(());
    }
    Err(AppError::user(
        "tui_confirmation_context_changed",
        format!(
            "TUI confirmation {label} changed from `{expected}` to `{actual}` before broadcast."
        ),
        Some("Cancel and reopen the action preview before sending the transaction.".to_string()),
    ))
}

fn ensure_confirmation_chain_id(expected: Option<u64>, actual: Option<u64>) -> AppResult<()> {
    if expected == actual {
        return Ok(());
    }
    let expected = expected.map_or("unknown".to_string(), |chain_id| chain_id.to_string());
    let actual = actual.map_or("unknown".to_string(), |chain_id| chain_id.to_string());
    ensure_confirmation_field("chain id", &expected, &actual)
}

fn send_confirmed_function(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(ConfirmForm::Send(form)) = app.confirm_form.take() else {
        return;
    };

    let result = interact::context(cli, &form.target).and_then(|context| {
        write::preflight_write_policy(cli, &context.network)?;
        ensure_send_context_matches(&form, &context)?;
        let (private_key, signer_address) =
            write::private_key_for_write(cli, &context.network, &context.account)?;
        ensure_signer_matches(form.signer_address.as_deref(), &signer_address)?;
        let submitted = interact::send_raw(
            &context,
            &form.signature,
            &form.args,
            form.value.as_deref(),
            &private_key,
        )?;
        if submitted.tx_hash.is_some() {
            let _ = tx::record_send(tx::SendRecordInput {
                project_root: &context.resolved.project_root,
                contract: &context.resolved.contract_name,
                target: Some(&form.target),
                address: &context.address,
                function: &form.signature,
                signature: &form.signature,
                args: &form.args,
                value: form.value.as_deref(),
                gas_estimate: form.gas_estimate.as_deref(),
                gas_estimate_error: None,
                signer_address: form.signer_address.as_deref(),
                nonce: form.nonce.as_deref(),
                gas_price: form.gas_price.as_deref(),
                calldata_hash: form.calldata_hash.as_deref(),
                calldata_prefix: form.calldata_prefix.as_deref(),
                submitted: &submitted,
                network: &context.network,
                account: &context.account,
            });
        }
        Ok(submitted)
    });

    match result {
        Ok(submitted) => {
            let result = submitted
                .tx_hash
                .map(|hash| format!("{} -> {hash}", form.signature))
                .unwrap_or_else(|| format!("{} sent", form.signature));
            refresh_after_send(cli, args, app, &form.signature);
            app.last_function_result = Some(result);
        }
        Err(err) => {
            app.status = format!("send failed: {}", err.message());
            app.last_function_result = error_result(&err);
        }
    }
}

fn deploy_confirmed_contract(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(ConfirmForm::Deploy(form)) = app.confirm_form.take() else {
        return;
    };

    let result = detect::active_network(cli).and_then(|network| {
        write::preflight_write_policy(cli, &network)?;
        ensure_deploy_network_matches(&form, &network)?;
        let account = detect::active_account(cli)?;
        ensure_deploy_account_matches(&form, &account)?;
        let (_, signer_address) = write::private_key_for_write(cli, &network, &account)?;
        ensure_signer_matches(form.signer_address.as_deref(), &signer_address)?;
        deploy::execute_preconfirmed(
            cli,
            &DeployArgs {
                target: Some(form.target.clone()),
                all: false,
                list: false,
                forget: None,
                constructor_args: form.args.clone(),
            },
        )
    });

    match result {
        Ok((data, _, _)) => {
            let status = if data.cached {
                format!("cached deploy {}", data.contract)
            } else {
                format!("deployed {}", data.contract)
            };
            let result = deploy_summary(&data);
            refresh_after_deploy(cli, args, app, status);
            app.last_function_result = Some(result);
        }
        Err(err) => {
            app.status = format!("deploy failed: {}", err.message());
            app.last_function_result = error_result(&err);
        }
    }
}

fn refresh_after_deploy(cli: &Cli, args: &TargetArgs, app: &mut DevApp, status: String) {
    let target = app.data.target.clone();
    match load_data_with_target(cli, args, target) {
        Ok(data) => {
            replace_data_preserving_feed(app, data);
            set_active_panel(app, FUNCTIONS_PANEL_INDEX);
            clamp_selected_contract(app);
            clamp_selected_function(app);
            clamp_selected_command(app);
            app.status = status;
            push_feed(app, DevFeedEvent::info(app.status.clone()));
        }
        Err(err) => {
            app.status = format!("{status}; refresh failed: {}", err.message());
            push_feed(app, DevFeedEvent::error(app.status.clone()));
        }
    }
}

fn deploy_summary(data: &deploy::DeployData) -> String {
    let action = if data.cached { "cached" } else { "deployed" };
    match &data.tx_hash {
        Some(tx_hash) => format!(
            "{} {action} at {} -> {tx_hash}",
            data.contract, data.address
        ),
        None => format!("{} {action} at {}", data.contract, data.address),
    }
}

fn refresh_after_send(cli: &Cli, args: &TargetArgs, app: &mut DevApp, signature: &str) {
    let target = app.data.target.clone();
    match load_data_with_target(cli, args, target) {
        Ok(data) => {
            replace_data_preserving_feed(app, data);
            set_active_panel(app, FUNCTIONS_PANEL_INDEX);
            clamp_selected_contract(app);
            clamp_selected_function(app);
            clamp_selected_command(app);
            app.status = format!("sent {signature}");
            push_feed(app, DevFeedEvent::info(app.status.clone()));
        }
        Err(err) => {
            app.status = format!("sent {signature}; refresh failed: {}", err.message());
            push_feed(app, DevFeedEvent::warn(app.status.clone()));
        }
    }
}

fn switch_network_in_tui(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    if let Some(blocker) = network_switch_blocker(cli) {
        app.status = "network switch blocked".to_string();
        app.last_function_result = Some(format!(
            "{blocker}. Restart `consol dev` without that override, or use `consol network use <name>`."
        ));
        return;
    }

    match select_next_network(cli, &app.data.network.name) {
        Ok(network) => refresh_after_context_switch(
            cli,
            args,
            app,
            format!(
                "network switched to {} ({})",
                network.name, network.write_policy
            ),
        ),
        Err(err) => {
            app.status = format!("network switch failed: {}", err.message());
            app.last_function_result = error_result(&err);
        }
    }
}

fn switch_account_in_tui(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    if let Some(blocker) = account_switch_blocker(cli) {
        app.status = "account switch blocked".to_string();
        app.last_function_result = Some(format!(
            "{blocker}. Restart `consol dev` without that override, or use `consol account use <name>`."
        ));
        return;
    }

    match select_next_account(&app.data.account.name) {
        Ok(account) => refresh_after_context_switch(
            cli,
            args,
            app,
            format!("account switched to {} ({})", account.name, account.signer),
        ),
        Err(err) => {
            app.status = format!("account switch failed: {}", err.message());
            app.last_function_result = error_result(&err);
        }
    }
}

fn switch_contract_in_tui(cli: &Cli, args: &TargetArgs, app: &mut DevApp, delta: isize) {
    let count = app.data.contracts.len();
    if count == 0 {
        app.status = "no contracts discovered".to_string();
        app.last_function_result =
            Some("Run `consol build` first, or launch `consol dev <target>`.".to_string());
        return;
    }

    let next_index = if delta.is_negative() {
        (app.selected_contract + count - 1) % count
    } else {
        (app.selected_contract + 1) % count
    };
    let contract = app.data.contracts[next_index].clone();
    match load_data_with_target(cli, args, Some(contract.target.clone())) {
        Ok(data) => {
            replace_data_preserving_feed(app, data);
            app.selected_contract = next_index.min(app.data.contracts.len().saturating_sub(1));
            clamp_selected_contract(app);
            clamp_selected_function(app);
            clamp_selected_command(app);
            set_active_panel(app, FUNCTIONS_PANEL_INDEX);
            app.last_function_result = None;
            app.status = format!("contract: {}", contract.name);
            push_feed(app, DevFeedEvent::info(app.status.clone()));
        }
        Err(err) => {
            app.status = format!("contract switch failed: {}", err.message());
            app.last_function_result = error_result(&err);
            push_feed(app, DevFeedEvent::error(app.status.clone()));
        }
    }
}

fn refresh_after_context_switch(cli: &Cli, args: &TargetArgs, app: &mut DevApp, status: String) {
    let target = app.data.target.clone();
    match load_data_with_target(cli, args, target) {
        Ok(data) => {
            replace_data_preserving_feed(app, data);
            let active_panel = app.active_panel.min(app.data.panels.len() - 1);
            set_active_panel(app, active_panel);
            clamp_selected_contract(app);
            clamp_selected_function(app);
            clamp_selected_command(app);
            app.last_function_result = None;
            app.status = status;
            push_feed(app, DevFeedEvent::info(app.status.clone()));
        }
        Err(err) => {
            app.status = format!("{status}; refresh failed: {}", err.message());
            app.last_function_result = error_result(&err);
            push_feed(app, DevFeedEvent::warn(app.status.clone()));
        }
    }
}

fn auto_refresh_live_data(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(target) = app.data.target.clone() else {
        return;
    };
    let before = live_summary(&app.data);
    match load_data_with_target(cli, args, Some(target)) {
        Ok(data) => {
            let after = live_summary(&data);
            if after != before {
                let message = live_change_message(&app.data, &data);
                replace_data_preserving_feed(app, data);
                clamp_selected_contract(app);
                clamp_selected_function(app);
                clamp_selected_command(app);
                push_feed(app, DevFeedEvent::info(message));
            }
        }
        Err(err) => {
            push_feed(
                app,
                DevFeedEvent::warn(format!("auto refresh failed: {}", err.message())),
            );
        }
    }
}

fn live_summary(data: &DevData) -> String {
    let state = state_values_fingerprint(data);
    let events = events_fingerprint(data);
    format!(
        "{}:{:?}:{state}:{events}",
        data.deployment.status, data.deployment.message
    )
}

fn live_change_message(before: &DevData, after: &DevData) -> &'static str {
    let deployment_changed = before.deployment.status != after.deployment.status
        || before.deployment.message != after.deployment.message;
    let state_changed = state_values_fingerprint(before) != state_values_fingerprint(after);
    let events_changed = events_fingerprint(before) != events_fingerprint(after);

    if deployment_changed {
        "deployment status updated"
    } else if state_changed && events_changed {
        "state/activity updated"
    } else if state_changed {
        "state watch updated"
    } else if events_changed {
        "activity updated"
    } else {
        "live data refreshed"
    }
}

fn state_values_fingerprint(data: &DevData) -> String {
    data.state
        .values
        .iter()
        .map(|value| format!("{}={}", value.signature, value.raw))
        .collect::<Vec<_>>()
        .join("|")
}

fn events_fingerprint(data: &DevData) -> String {
    data.events
        .events
        .iter()
        .map(|event| {
            format!(
                "{}:{:?}:{:?}",
                event.label, event.block_number, event.transaction_hash
            )
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn select_next_network(cli: &Cli, current: &str) -> AppResult<NetworkMeta> {
    let mut raw_config = config::load()?;
    let runtime_config = config::with_builtin_profiles(raw_config.clone());
    let names = runtime_config.networks.keys().cloned().collect::<Vec<_>>();
    if names.is_empty() {
        return Err(AppError::user(
            "network_profiles_empty",
            "No network profiles are available.",
            Some(
                "Add one with `consol network add`, or use the built-in `local` profile."
                    .to_string(),
            ),
        ));
    }

    let mut first_error = None;
    for name in next_profile_candidates(current, &names) {
        match config::network_by_name_with_config(&runtime_config, &name, cli.chain_id) {
            Ok(network) => {
                raw_config.active_network = Some(name);
                config::save(&raw_config)?;
                return Ok(network);
            }
            Err(err) => {
                first_error.get_or_insert(err);
            }
        }
    }

    Err(first_error.unwrap_or_else(|| {
        AppError::user(
            "network_profiles_unavailable",
            "No network profiles can be resolved.",
            Some(
                "Check `consol network list` for missing RPC URLs or chain-id mismatches."
                    .to_string(),
            ),
        )
    }))
}

fn select_next_account(current: &str) -> AppResult<AccountMeta> {
    let mut raw_config = config::load()?;
    let names = account_profile_names(&raw_config, current);
    let next = next_profile_name(current, &names).ok_or_else(|| {
        AppError::user(
            "account_profiles_empty",
            "No account profiles are available.",
            Some(
                "Use the built-in `anvil0` profile or import one with `consol account import`."
                    .to_string(),
            ),
        )
    })?;
    let account = config::account_meta_from_selector(&raw_config, &next)?;
    if account.signer == "selected" {
        return Err(AppError::user(
            "account_not_found",
            format!("Account profile `{next}` does not exist."),
            Some(
                "Run `consol account list` or import one with `consol account import`.".to_string(),
            ),
        ));
    }
    raw_config.active_account = Some(next);
    config::save(&raw_config)?;
    Ok(account)
}

fn account_profile_names(config: &config::Config, current: &str) -> Vec<String> {
    let mut names = Vec::new();
    push_unique(&mut names, "anvil0");
    if std::env::var("ETH_PRIVATE_KEY").is_ok()
        || current == "env"
        || config.active_account.as_deref() == Some("env")
    {
        push_unique(&mut names, "env");
    }
    for name in config.accounts.keys() {
        push_unique(&mut names, name);
    }
    names
}

fn next_profile_name(current: &str, names: &[String]) -> Option<String> {
    next_profile_candidates(current, names).into_iter().next()
}

fn next_profile_candidates(current: &str, names: &[String]) -> Vec<String> {
    if names.is_empty() {
        return Vec::new();
    }
    let start = names
        .iter()
        .position(|name| name == current)
        .map_or(0, |index| (index + 1) % names.len());
    (0..names.len())
        .map(|offset| names[(start + offset) % names.len()].clone())
        .collect()
}

fn push_unique(names: &mut Vec<String>, name: impl Into<String>) {
    let name = name.into();
    if !names.iter().any(|existing| existing == &name) {
        names.push(name);
    }
}

fn network_switch_blocker(cli: &Cli) -> Option<String> {
    if cli.network.is_some() {
        return Some("`--network` override is active".to_string());
    }
    if cli.rpc_url.is_some() {
        return Some("`--rpc-url` override is active".to_string());
    }
    if std::env::var("ETH_RPC_URL").is_ok() {
        return Some("`ETH_RPC_URL` override is active".to_string());
    }
    None
}

fn account_switch_blocker(cli: &Cli) -> Option<String> {
    if cli.account.is_some() {
        return Some("`--account` override is active".to_string());
    }
    if cli.signer.is_some() {
        return Some("`--signer` override is active".to_string());
    }
    None
}

fn copy_text_to_clipboard(text: &str) -> AppResult<&'static str> {
    for (program, args, label) in clipboard_backends() {
        let child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        let Ok(mut child) = child else {
            continue;
        };
        let Some(mut stdin) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            continue;
        };
        if stdin.write_all(text.as_bytes()).is_err() {
            let _ = child.kill();
            let _ = child.wait();
            continue;
        }
        drop(stdin);
        if child.wait().is_ok_and(|status| status.success()) {
            return Ok(label);
        }
    }

    Err(AppError::user(
        "clipboard_unavailable",
        "No supported clipboard command was available.",
        Some(
            "Install pbcopy, wl-copy, xclip, or xsel, or copy the shown command manually."
                .to_string(),
        ),
    ))
}

fn clipboard_backends() -> Vec<(&'static str, Vec<&'static str>, &'static str)> {
    if cfg!(target_os = "macos") {
        return vec![("pbcopy", Vec::new(), "pbcopy")];
    }
    vec![
        ("wl-copy", Vec::new(), "wl-copy"),
        ("xclip", vec!["-selection", "clipboard"], "xclip"),
        ("xsel", vec!["--clipboard", "--input"], "xsel"),
        ("pbcopy", Vec::new(), "pbcopy"),
    ]
}

fn error_result(err: &AppError) -> Option<String> {
    err.hint().map_or_else(
        || Some(err.message()),
        |hint| Some(format!("{} Hint: {}", err.message(), hint)),
    )
}

fn shell_words(input: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;
    let mut token_started = false;

    for ch in input.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            token_started = true;
            continue;
        }

        if ch == '\\' {
            escaped = true;
            token_started = true;
            continue;
        }

        if let Some(quote_ch) = quote {
            if ch == quote_ch {
                quote = None;
            } else {
                current.push(ch);
            }
            token_started = true;
            continue;
        }

        match ch {
            '"' | '\'' => {
                quote = Some(ch);
                token_started = true;
            }
            ch if ch.is_whitespace() => {
                if token_started {
                    args.push(std::mem::take(&mut current));
                    token_started = false;
                }
            }
            _ => {
                current.push(ch);
                token_started = true;
            }
        }
    }

    if escaped {
        return Err("Trailing escape in argument input.".to_string());
    }
    if let Some(quote) = quote {
        return Err(format!("Unclosed quote `{quote}` in argument input."));
    }
    if token_started {
        args.push(current);
    }
    Ok(args)
}

fn run_build_in_tui(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let target = current_target(args, app);
    match build::build_data(cli, target.as_deref()) {
        Ok(data) => {
            let status = data.status.clone();
            let count = data.diagnostics.len();
            let diagnostics = DevDiagnosticsPanel::from_build(data);
            if count == 0 {
                match load_data_with_target(cli, args, app.data.target.clone()) {
                    Ok(mut refreshed) => {
                        refreshed.diagnostics = diagnostics;
                        replace_data_preserving_feed(app, refreshed);
                        set_active_panel(app, FUNCTIONS_PANEL_INDEX);
                        clamp_selected_contract(app);
                        clamp_selected_function(app);
                        clamp_selected_command(app);
                        app.status = format!("build {status}; ABI ready");
                        push_feed(app, DevFeedEvent::info(app.status.clone()));
                    }
                    Err(err) => {
                        app.data.diagnostics = diagnostics;
                        set_active_panel(app, DIAGNOSTICS_PANEL_INDEX);
                        app.status = format!("build {status}; refresh failed: {}", err.message());
                        app.last_function_result = error_result(&err);
                        push_feed(app, DevFeedEvent::warn(app.status.clone()));
                    }
                }
            } else {
                app.data.diagnostics = diagnostics;
                set_active_panel(app, DIAGNOSTICS_PANEL_INDEX);
                app.status = format!("build {status}: {count} diagnostic(s)");
                push_feed(app, DevFeedEvent::warn(app.status.clone()));
            }
        }
        Err(err) => {
            app.data.diagnostics = DevDiagnosticsPanel::empty(panel_status_from_error(&err));
            set_active_panel(app, DIAGNOSTICS_PANEL_INDEX);
            app.status = format!("build failed: {}", err.message());
            push_feed(app, DevFeedEvent::error(app.status.clone()));
        }
    }
}

fn setup_terminal() -> io::Result<Terminal<CrosstermBackend<Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    Terminal::new(backend)
}

struct TerminalGuard;

impl TerminalGuard {
    fn new() -> Self {
        diagnostics::set_tui_active(true);
        Self
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        diagnostics::set_tui_active(false);
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), DisableMouseCapture, LeaveAlternateScreen);
        let _ = diagnostics::append_dev_log("info", "dev session ended");
    }
}

fn should_quit(key: KeyEvent, input_active: bool) -> bool {
    (!input_active && key.code == KeyCode::Char('q'))
        || (key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL))
}

fn quit_reason(key: KeyEvent) -> String {
    if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
        "quit requested by Ctrl-C".to_string()
    } else if key.code == KeyCode::Char('q') {
        "quit requested by q".to_string()
    } else {
        format!("quit requested by {:?}", key.code)
    }
}

fn render(frame: &mut Frame<'_>, app: &DevApp) {
    let area = frame.area();
    frame.render_widget(Clear, area);

    let mode = dev_layout_mode(area);
    let header_height = if mode == DevLayoutMode::Short { 4 } else { 5 };
    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(header_height),
            Constraint::Min(8),
            Constraint::Length(3),
        ])
        .split(area);

    render_header(frame, root[0], app, mode);
    render_body(frame, root[1], app, mode);
    render_footer(frame, root[2], app);
    render_contract_picker(frame, area, app);
    render_input_form(frame, area, app);
    render_confirm_form(frame, area, app);
}

fn render_body(frame: &mut Frame<'_>, area: Rect, app: &DevApp, mode: DevLayoutMode) {
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(8)])
        .split(area);
    render_tabs(frame, rows[0], app, mode);
    render_panel(frame, rows[1], app, app.active_panel);
}

fn dev_layout_mode(area: Rect) -> DevLayoutMode {
    if area.width < 90 {
        DevLayoutMode::Narrow
    } else if area.height < 24 {
        DevLayoutMode::Short
    } else {
        DevLayoutMode::Wide
    }
}

fn render_header(frame: &mut Frame<'_>, area: Rect, app: &DevApp, mode: DevLayoutMode) {
    let title = Line::from(vec![
        Span::styled(
            "ConSol dev",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(format!(
            "  {}  {}  {}",
            app.data.contract.as_deref().unwrap_or("select contract"),
            app.data.network.name,
            app.data.account.name
        )),
    ]);
    let subtitle = header_next_line(&app.data, mode);
    let status = format!("Status: {}", app.status);
    frame.render_widget(
        Paragraph::new(vec![title, Line::from(subtitle), Line::from(status)])
            .block(Block::default().borders(Borders::ALL).title("dev")),
        area,
    );
}

fn header_next_line(data: &DevData, mode: DevLayoutMode) -> String {
    if mode == DevLayoutMode::Narrow {
        return "Next: / find, arrows select, Enter/c run, b build, d deploy".to_string();
    }
    format!("Next: {}", next_step_line(data))
}

fn render_tabs(frame: &mut Frame<'_>, area: Rect, app: &DevApp, mode: DevLayoutMode) {
    let indexes = visible_panel_indexes(mode);
    let titles = tab_titles(area.width, &app.data.panels, &indexes)
        .into_iter()
        .map(Line::from)
        .collect::<Vec<_>>();
    frame.render_widget(
        Tabs::new(titles)
            .block(Block::default().borders(Borders::ALL).title("workspace"))
            .select(selected_tab_index(app.active_panel, &indexes))
            .style(Style::default().fg(Color::Gray))
            .highlight_style(
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
        area,
    );
}

fn visible_panel_indexes(_mode: DevLayoutMode) -> Vec<usize> {
    (0..PANEL_TITLES.len()).collect()
}

fn selected_tab_index(active_panel: usize, indexes: &[usize]) -> usize {
    indexes
        .iter()
        .position(|index| *index == active_panel)
        .or_else(|| {
            indexes
                .iter()
                .position(|index| *index == FUNCTIONS_PANEL_INDEX)
        })
        .unwrap_or(0)
}

fn tab_titles(width: u16, panels: &[String], indexes: &[usize]) -> Vec<String> {
    indexes
        .iter()
        .map(|index| {
            let title = panels.get(*index).map(String::as_str).unwrap_or("Panel");
            if width < 90 {
                compact_tab_title(title).to_string()
            } else {
                title.to_string()
            }
        })
        .collect()
}

fn compact_tab_title(title: &str) -> &'static str {
    match title {
        "Sources" => "Src",
        "Overview" => "Info",
        "State" => "State",
        "Events" => "Logs",
        "Contract" => "Run",
        "Build" => "Build",
        "Activity" => "Act",
        "Help" => "Help",
        _ => "Panel",
    }
}

fn render_panel(frame: &mut Frame<'_>, area: Rect, app: &DevApp, panel_index: usize) {
    match panel_index {
        STATUS_PANEL_INDEX => render_status_panel(frame, area, app),
        STATE_PANEL_INDEX => render_text_panel_focused(
            frame,
            area,
            "state",
            state_lines(&app.data.state),
            app.focus == DevPaneFocus::Main,
        ),
        EVENTS_PANEL_INDEX => render_text_panel_focused(
            frame,
            area,
            "events",
            event_lines(&app.data.events),
            app.focus == DevPaneFocus::Main,
        ),
        FUNCTIONS_PANEL_INDEX => render_contract_workspace(frame, area, app),
        DIAGNOSTICS_PANEL_INDEX => render_text_panel_focused(
            frame,
            area,
            "build",
            diagnostic_lines(&app.data.diagnostics),
            app.focus == DevPaneFocus::Main,
        ),
        FEED_PANEL_INDEX => render_activity_panel(
            frame,
            area,
            &app.data,
            app.trace_result.as_ref(),
            app.activity_scroll,
            ActivityPanelOptions::new(
                "activity",
                ActivityPanelKind::Full,
                app.focus == DevPaneFocus::Activity,
            ),
        ),
        _ => render_text_panel_focused(
            frame,
            area,
            "help / cli equivalents",
            workflow_lines(&app.data, app.selected_command),
            app.focus == DevPaneFocus::Main,
        ),
    }
}

fn render_contract_workspace(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    if area.height < 14 {
        let mut lines = contract_workspace_lines(
            &app.data,
            app.selected_function,
            app.last_function_result.as_deref(),
        );
        lines.push(Line::from(""));
        lines.extend(compact_state_log_lines(&app.data));
        render_text_panel_focused(
            frame,
            area,
            "contract",
            lines,
            app.focus == DevPaneFocus::ContractFunctions,
        );
        return;
    }

    if area.width >= 108 {
        let state_log_width = ((area.width as f32 * 0.44) as u16).clamp(44, 76);
        let columns = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(50), Constraint::Length(state_log_width)])
            .split(area);
        let right = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Percentage(54), Constraint::Percentage(46)])
            .split(columns[1]);
        render_text_panel_focused(
            frame,
            columns[0],
            "contract",
            contract_workspace_lines(
                &app.data,
                app.selected_function,
                app.last_function_result.as_deref(),
            ),
            app.focus == DevPaneFocus::ContractFunctions,
        );
        render_text_panel_focused(
            frame,
            right[0],
            "state watch",
            state_watch_lines(&app.data, 10),
            app.focus == DevPaneFocus::ContractState,
        );
        render_activity_panel(
            frame,
            right[1],
            &app.data,
            app.trace_result.as_ref(),
            app.activity_scroll,
            ActivityPanelOptions::new(
                "activity",
                ActivityPanelKind::Compact,
                app.focus == DevPaneFocus::ContractActivity,
            ),
        );
        return;
    }

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(58), Constraint::Percentage(42)])
        .split(area);
    render_text_panel_focused(
        frame,
        rows[0],
        "contract",
        contract_workspace_lines(
            &app.data,
            app.selected_function,
            app.last_function_result.as_deref(),
        ),
        app.focus == DevPaneFocus::ContractFunctions,
    );

    if rows[1].width >= 88 && rows[1].height >= 7 {
        let lower = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(rows[1]);
        render_text_panel_focused(
            frame,
            lower[0],
            "state watch",
            state_watch_lines(&app.data, 6),
            app.focus == DevPaneFocus::ContractState,
        );
        render_activity_panel(
            frame,
            lower[1],
            &app.data,
            app.trace_result.as_ref(),
            app.activity_scroll,
            ActivityPanelOptions::new(
                "activity",
                ActivityPanelKind::Compact,
                app.focus == DevPaneFocus::ContractActivity,
            ),
        );
    } else {
        let mut lines = state_watch_lines(&app.data, 4);
        lines.push(Line::from(""));
        let log_limit =
            compact_mixed_activity_limit(rows[1], lines.len(), app.trace_result.as_ref());
        lines.extend(workspace_log_lines(
            &app.data,
            app.trace_result.as_ref(),
            log_limit,
            app.activity_scroll,
            rows[1].width,
        ));
        render_text_panel_focused(
            frame,
            rows[1],
            "state / activity",
            lines,
            app.focus == DevPaneFocus::ContractState,
        );
    }
}

fn render_status_panel(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    if area.width < 88 || area.height < 14 {
        let mut lines = status_lines(&app.data);
        lines.push(Line::from(""));
        lines.extend(panel_summary_lines(&app.data).into_iter().take(16));
        frame.render_widget(
            Paragraph::new(lines)
                .block(Block::default().borders(Borders::ALL).title("status"))
                .wrap(Wrap { trim: false }),
            area,
        );
        return;
    }

    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(52), Constraint::Percentage(48)])
        .split(area);

    frame.render_widget(
        Paragraph::new(status_lines(&app.data))
            .block(Block::default().borders(Borders::ALL).title("status"))
            .wrap(Wrap { trim: false }),
        columns[0],
    );
    frame.render_widget(
        Paragraph::new(panel_summary_lines(&app.data))
            .block(Block::default().borders(Borders::ALL).title("live panels"))
            .wrap(Wrap { trim: false }),
        columns[1],
    );
}

fn render_text_panel_focused(
    frame: &mut Frame<'_>,
    area: Rect,
    title: &'static str,
    lines: Vec<Line<'static>>,
    focused: bool,
) {
    frame.render_widget(
        Paragraph::new(lines)
            .block(panel_block(title, focused))
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn panel_block(title: &'static str, focused: bool) -> Block<'static> {
    let title = if focused {
        format!("● {title}")
    } else {
        format!("  {title}")
    };
    Block::default()
        .borders(Borders::ALL)
        .border_style(if focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default().fg(Color::DarkGray)
        })
        .title(title)
}

#[derive(Debug, Clone, Copy)]
enum ActivityPanelKind {
    Compact,
    Full,
}

#[derive(Debug, Clone, Copy)]
struct ActivityPanelOptions {
    title: &'static str,
    kind: ActivityPanelKind,
    focused: bool,
}

impl ActivityPanelOptions {
    fn new(title: &'static str, kind: ActivityPanelKind, focused: bool) -> Self {
        Self {
            title,
            kind,
            focused,
        }
    }
}

fn render_activity_panel(
    frame: &mut Frame<'_>,
    area: Rect,
    data: &DevData,
    trace_result: Option<&DevTraceResult>,
    scroll_offset: usize,
    options: ActivityPanelOptions,
) {
    let limit = activity_visible_limit(area, trace_result, options.kind);
    let lines = match options.kind {
        ActivityPanelKind::Compact => {
            workspace_log_lines(data, trace_result, limit, scroll_offset, area.width)
        }
        ActivityPanelKind::Full => feed_lines(data, trace_result, limit, scroll_offset, area.width),
    };
    frame.render_widget(
        Paragraph::new(lines).block(panel_block(options.title, options.focused)),
        area,
    );
    render_activity_scrollbar(frame, area, data, limit, scroll_offset);
}

fn render_activity_scrollbar(
    frame: &mut Frame<'_>,
    area: Rect,
    data: &DevData,
    limit: usize,
    scroll_offset: usize,
) {
    let total = activity_log_rows(data, area.width).len();
    if total <= limit || area.height < 4 || area.width < 8 {
        return;
    }
    let position = clamped_activity_offset(total, limit, scroll_offset);
    let mut state = ScrollbarState::new(total).position(position);
    let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
        .thumb_symbol("#")
        .track_symbol(Some("."))
        .begin_symbol(None)
        .end_symbol(None)
        .thumb_style(Style::default().fg(Color::Cyan))
        .track_style(Style::default().fg(Color::DarkGray));
    frame.render_stateful_widget(
        scrollbar,
        area.inner(Margin {
            vertical: 1,
            horizontal: 0,
        }),
        &mut state,
    );
}

fn render_contract_picker(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    let Some(picker) = &app.picker else {
        return;
    };
    let height = area.height.saturating_sub(4).clamp(8, 18);
    let input_area = centered_rect(area, 86, height);
    let entries = contract_picker_entries(&app.data.source_explorer, &picker.query);
    let visible_rows = input_area.height.saturating_sub(6) as usize;
    let offset = picker
        .selected
        .saturating_sub(visible_rows.saturating_sub(1));
    let mut lines = vec![
        Line::from(t("contract-picker-prompt")),
        Line::from(vec![
            Span::styled("> ", Style::default().fg(Color::Green)),
            Span::raw(if picker.query.is_empty() {
                ""
            } else {
                &picker.query
            }),
            Span::styled(" ", Style::default().bg(Color::Cyan)),
        ]),
        Line::from(t("contract-picker-help")),
        Line::from(""),
    ];

    if entries.is_empty() {
        lines.push(Line::from(t("contract-picker-empty")));
    } else {
        for (index, entry) in entries.iter().enumerate().skip(offset).take(visible_rows) {
            let selected = index == picker.selected;
            let current = app.data.target.as_deref() == entry.target.as_deref();
            lines.push(contract_picker_line(entry, selected, current));
        }
    }

    frame.render_widget(Clear, input_area);
    frame.render_widget(
        Paragraph::new(lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(t("contract-picker-title")),
            )
            .wrap(Wrap { trim: false }),
        input_area,
    );
}

fn contract_picker_line(entry: &SourceEntry, selected: bool, current: bool) -> Line<'static> {
    let marker = if selected {
        ">"
    } else if current {
        "*"
    } else {
        " "
    };
    let contract = entry.contract_name.as_deref().unwrap_or("<file>");
    let kind = entry.contract_kind.as_deref().unwrap_or("source");
    Line::from(vec![
        Span::styled(marker, Style::default().fg(Color::Cyan)),
        Span::raw(" "),
        Span::styled(
            format!("{:<10}", contract),
            Style::default().fg(Color::Green),
        ),
        Span::styled(
            format!("{:<10}", kind),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw(entry.file_path.clone()),
    ])
}

fn render_input_form(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    let Some(form) = &app.input_form else {
        return;
    };
    let rows = input_param_rows(form);
    let error_height = u16::from(form.error.is_some()) * 3;
    let height = (rows.len() as u16 + 15 + error_height).clamp(14, 24);
    let input_area = centered_rect(area, 84, height);
    let mut lines = vec![
        Line::from(vec![
            Span::styled("ABI input ", active_title_style()),
            Span::styled("action ", Style::default().fg(Color::DarkGray)),
            Span::styled(form.action.label(), active_title_style()),
            Span::styled("  function ", Style::default().fg(Color::DarkGray)),
            Span::raw(form.signature.clone()),
        ]),
        Line::from(form.prompt.clone()),
        Line::from(""),
        Line::from(t("input-args-order")),
        Line::from(t("input-args-strings")),
        Line::from(t("input-args-numbers")),
        Line::from(t("input-args-complex")),
        Line::from(""),
        Line::from(vec![Span::styled(
            t("input-args-columns"),
            Style::default().fg(Color::DarkGray),
        )]),
    ];
    for row in &rows {
        let format_width = input_area.width.saturating_sub(46) as usize;
        lines.push(Line::from(vec![
            Span::styled(
                format!("{:<3}", row.index),
                Style::default().fg(Color::DarkGray),
            ),
            Span::styled(
                format!("{:<20}", compact_text(&row.name, 19)),
                Style::default().fg(Color::Green),
            ),
            Span::styled(
                format!("{:<12}", compact_text(&row.kind, 11)),
                Style::default().fg(Color::DarkGray),
            ),
            Span::raw(compact_text(&row.format, format_width.max(18))),
        ]));
    }
    lines.extend([
        Line::from(""),
        Line::from(vec![
            Span::styled("> ", Style::default().fg(Color::Green)),
            Span::raw(form.text.clone()),
            Span::styled(" ", Style::default().bg(Color::Cyan)),
        ]),
    ]);
    if let Some(error) = &form.error {
        lines.push(Line::from(""));
        for (index, line) in error.lines().take(4).enumerate() {
            lines.push(Line::from(vec![
                Span::styled(
                    if index == 0 { "error " } else { "      " },
                    Style::default().fg(Color::Red),
                ),
                Span::raw(compact_text(
                    line,
                    input_area.width.saturating_sub(10) as usize,
                )),
            ]));
        }
    }
    if !form.text.trim().is_empty() {
        lines.push(Line::from(vec![
            Span::styled("cached ", Style::default().fg(Color::DarkGray)),
            Span::raw(t("input-args-cache")),
        ]));
    }
    lines.push(Line::from(t("input-args-submit")));
    frame.render_widget(Clear, input_area);
    frame.render_widget(
        Paragraph::new(lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(t("input-args-title")),
            )
            .wrap(Wrap { trim: false }),
        input_area,
    );
}

fn input_param_rows(form: &ActionInputForm) -> Vec<InputParamRow> {
    let mut rows = Vec::new();
    if form.action == ActionKind::Payable {
        rows.push(InputParamRow {
            index: 1,
            name: "value".to_string(),
            kind: "wei".to_string(),
            format: t("input-rule-value"),
        });
    }
    let offset = rows.len();
    for (index, param) in form.params.iter().enumerate() {
        rows.push(InputParamRow {
            index: offset + index + 1,
            name: if param.name.is_empty() {
                format!("arg{}", index + 1)
            } else {
                param.name.clone()
            },
            kind: param.kind.clone(),
            format: abi_input_rule(&param.kind),
        });
    }
    rows
}

fn abi_input_rule(kind: &str) -> String {
    let kind = kind.trim();
    if is_tuple_type(kind) {
        if is_array_type(kind) {
            t("input-rule-tuple-array")
        } else {
            t("input-rule-tuple")
        }
    } else if is_array_type(kind) {
        t("input-rule-array")
    } else if kind == "string" {
        t("input-rule-string")
    } else if kind == "bool" {
        t("input-rule-bool")
    } else if kind == "address" {
        t("input-rule-address")
    } else if kind.starts_with("uint") || kind.starts_with("int") {
        t("input-rule-number")
    } else if kind == "bytes" {
        t("input-rule-bytes")
    } else if kind.starts_with("bytes") {
        t("input-rule-fixed-bytes")
    } else {
        t("input-rule-generic")
    }
}

fn is_array_type(kind: &str) -> bool {
    kind.contains('[') && kind.ends_with(']')
}

fn is_tuple_type(kind: &str) -> bool {
    kind.starts_with('(')
}

fn render_confirm_form(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    match &app.confirm_form {
        Some(ConfirmForm::Send(form)) => render_send_confirm_form(frame, area, form),
        Some(ConfirmForm::Deploy(form)) => render_deploy_confirm_form(frame, area, form),
        None => {}
    }
}

fn render_send_confirm_form(frame: &mut Frame<'_>, area: Rect, form: &SendConfirmForm) {
    let input_area = centered_rect(
        area,
        82,
        if form.confirmation_expected.is_some() {
            20
        } else {
            18
        },
    );
    let args = if form.args.is_empty() {
        "<none>".to_string()
    } else {
        form.args.join(" ")
    };
    let value = form.value.as_deref().unwrap_or("0");
    let gas = form.gas_estimate.as_deref().unwrap_or("unavailable");
    let signer = form.signer_address.as_deref().unwrap_or("unknown");
    let nonce = form.nonce.as_deref().unwrap_or("unknown");
    let gas_price = form.gas_price.as_deref().unwrap_or("unknown");
    let mut lines = vec![
        Line::from(if form.confirmation_expected.is_some() {
            t("confirm-send-remote")
        } else {
            t("confirm-send-local")
        }),
        field("Network", &form.network),
        field(
            "Chain ID",
            &form
                .chain_id
                .map_or("unknown".to_string(), |chain_id| chain_id.to_string()),
        ),
        field("Policy", &form.write_policy),
        field("Account", &form.account),
        field("Signer", signer),
        field("Nonce", nonce),
        field("Gas Price", gas_price),
        field("To", &form.address),
        field("Value", value),
        field("Function", &form.signature),
        field("Args", &args),
        field("Gas", gas),
        field(
            "Calldata",
            form.calldata_prefix.as_deref().unwrap_or("unavailable"),
        ),
        field("Hash", form.calldata_hash.as_deref().unwrap_or("unknown")),
    ];
    if let Some(expected) = &form.confirmation_expected {
        lines.push(field(
            "Confirm",
            &tf("confirm-type", &[("expected", expected)]),
        ));
        let empty = t("confirm-input-empty");
        lines.push(field(
            "Input",
            if form.confirmation_input.is_empty() {
                empty.as_str()
            } else {
                &form.confirmation_input
            },
        ));
        lines.push(Line::from(t("confirm-esc-cancels")));
    } else {
        lines.push(Line::from(t("confirm-send-local-help")));
    }
    frame.render_widget(Clear, input_area);
    frame.render_widget(
        Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title("send"))
            .wrap(Wrap { trim: false }),
        input_area,
    );
}

fn render_deploy_confirm_form(frame: &mut Frame<'_>, area: Rect, form: &DeployConfirmForm) {
    let input_area = centered_rect(
        area,
        82,
        if form.confirmation_expected.is_some() {
            18
        } else {
            14
        },
    );
    let args = if form.args.is_empty() {
        "<none>".to_string()
    } else {
        form.args.join(" ")
    };
    let mut lines = vec![
        Line::from(if form.confirmation_expected.is_some() {
            t("confirm-deploy-remote")
        } else {
            t("confirm-deploy-local")
        }),
        field("Network", &form.network),
        field(
            "Chain ID",
            &form
                .chain_id
                .map_or("unknown".to_string(), |chain_id| chain_id.to_string()),
        ),
        field("Policy", &form.write_policy),
        field("Account", &form.account),
        field(
            "Signer",
            form.signer_address.as_deref().unwrap_or("unknown"),
        ),
        field("Nonce", form.nonce.as_deref().unwrap_or("unknown")),
        field("Gas Price", form.gas_price.as_deref().unwrap_or("unknown")),
        field("Contract", &form.contract),
        field("Target", &form.target),
        field("Args", &args),
    ];
    if let Some(expected) = &form.confirmation_expected {
        lines.push(field(
            "Confirm",
            &tf("confirm-type", &[("expected", expected)]),
        ));
        let empty = t("confirm-input-empty");
        lines.push(field(
            "Input",
            if form.confirmation_input.is_empty() {
                empty.as_str()
            } else {
                &form.confirmation_input
            },
        ));
        lines.push(Line::from(t("confirm-esc-cancels")));
    } else {
        lines.push(Line::from(t("confirm-deploy-local-help")));
    }
    frame.render_widget(Clear, input_area);
    frame.render_widget(
        Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title("deploy"))
            .wrap(Wrap { trim: false }),
        input_area,
    );
}

fn centered_rect(area: Rect, percent_x: u16, height: u16) -> Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(1),
            Constraint::Length(height.min(area.height)),
            Constraint::Min(1),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(vertical[1])[1]
}

fn render_footer(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    let hints = if app.confirm_form.is_some() {
        t("footer-confirm")
    } else if app.picker.is_some() {
        t("footer-picker")
    } else if app.input_form.is_some() {
        t("footer-input")
    } else if area.width < 80 {
        "Tab focus | Shift-Tab tabs | / pick | Enter run | q quit".to_string()
    } else {
        "Tab focus pane | Shift-Tab workspace | / picker | Up/Down move | Enter/c run | b build | d deploy | q quit"
            .to_string()
    };
    frame.render_widget(
        Paragraph::new(hints).block(Block::default().borders(Borders::ALL).title("keys")),
        area,
    );
}

fn status_lines(data: &DevData) -> Vec<Line<'static>> {
    vec![
        field("Target", data.target.as_deref().unwrap_or("workspace")),
        field(
            "Contract",
            data.contract.as_deref().unwrap_or("not selected"),
        ),
        field(
            "File",
            data.current_file.as_deref().unwrap_or("not selected"),
        ),
        field("Sources", &data.source_explorer.files.len().to_string()),
        field("Contracts", &data.contracts.len().to_string()),
        field("Source", &data.source_mode),
        field(
            "Project",
            data.project_root.as_deref().unwrap_or("not found"),
        ),
        field("Network", &data.network.name),
        field("RPC", &output::redact_rpc_url(&data.network.rpc_url)),
        field(
            "Chain",
            &data
                .network
                .chain_id
                .map_or("unknown".to_string(), |id| id.to_string()),
        ),
        field("Account", &data.account.name),
        field("Signer", &data.account.signer),
        field("Deploy", &data.deployment.status),
        field("forge", &data.tools.forge),
        field("cast", &data.tools.cast),
        field("anvil", &data.tools.anvil),
    ]
}

fn panel_summary_lines(data: &DevData) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    lines.push(Line::from(vec![
        Span::styled("Contracts   ", Style::default().fg(Color::DarkGray)),
        Span::raw(data.contracts.len().to_string()),
    ]));
    for contract in data.contracts.iter().take(5) {
        let marker = if data.target.as_deref() == Some(contract.target.as_str()) {
            ">"
        } else {
            " "
        };
        lines.push(Line::from(format!("  {marker} {}", contract.name)));
    }
    if data.contracts.len() > 5 {
        lines.push(Line::from(format!(
            "  +{} more contract(s)",
            data.contracts.len() - 5
        )));
    }
    lines.push(Line::from(""));
    lines.extend(status_block("Deployment", &data.deployment));
    lines.push(Line::from(""));
    lines.extend(status_block("State", &data.state.status));
    lines.push(field("Readers", &data.state.values.len().to_string()));
    lines.push(Line::from(""));
    lines.extend(status_block("Events", &data.events.status));
    lines.push(field("Decoded", &data.events.events.len().to_string()));
    lines.push(Line::from(""));
    lines.extend(status_block("Functions", &data.functions.status));
    lines.push(field("ABI funcs", &data.functions.items.len().to_string()));
    lines.push(Line::from(""));
    lines.extend(status_block("Diagnostics", &data.diagnostics.status));
    lines.push(field(
        "Issues",
        &data.diagnostics.diagnostics.len().to_string(),
    ));
    lines
}

fn status_block(label: &'static str, status: &PanelStatus) -> Vec<Line<'static>> {
    let mut lines = vec![Line::from(vec![
        Span::styled(format!("{label:<12}"), Style::default().fg(Color::DarkGray)),
        Span::styled(status.status.clone(), status_style(&status.status)),
    ])];
    if let Some(message) = &status.message {
        lines.push(Line::from(format!("  {message}")));
    }
    if let Some(hint) = &status.hint {
        lines.push(Line::from(vec![
            Span::styled("  hint: ", Style::default().fg(Color::DarkGray)),
            Span::raw(hint.clone()),
        ]));
    }
    lines
}

fn source_entries(explorer: &DevSourceExplorer) -> Vec<SourceEntry> {
    let mut entries = Vec::new();
    for file in &explorer.files {
        if file.contracts.is_empty() {
            entries.push(SourceEntry {
                file_path: file.path.clone(),
                contract_name: None,
                contract_kind: None,
                target: None,
                search_text: format!("{} {}", file.path, file.category).to_ascii_lowercase(),
            });
            continue;
        }

        for contract in &file.contracts {
            entries.push(SourceEntry {
                file_path: file.path.clone(),
                contract_name: Some(contract.name.clone()),
                contract_kind: Some(contract.kind.clone()),
                target: Some(contract.target.clone()),
                search_text: format!(
                    "{} {} {} {}",
                    file.path, file.category, contract.kind, contract.name
                )
                .to_ascii_lowercase(),
            });
        }
    }
    entries
}

fn contract_picker_entries(explorer: &DevSourceExplorer, query: &str) -> Vec<SourceEntry> {
    let query = query.trim().to_ascii_lowercase();
    let mut scored = source_entries(explorer)
        .into_iter()
        .filter(|entry| entry.target.is_some())
        .filter_map(|entry| {
            let score = fuzzy_query_score(&entry.search_text, &query)?;
            Some((score, entry))
        })
        .collect::<Vec<_>>();
    scored.sort_by(|(left_score, left), (right_score, right)| {
        left_score
            .cmp(right_score)
            .then_with(|| left.file_path.cmp(&right.file_path))
            .then_with(|| left.contract_name.cmp(&right.contract_name))
    });
    scored.into_iter().map(|(_, entry)| entry).collect()
}

fn fuzzy_query_score(haystack: &str, query: &str) -> Option<usize> {
    if query.is_empty() {
        return Some(0);
    }
    query.split_whitespace().try_fold(0usize, |score, token| {
        fuzzy_score(haystack, token).map(|token_score| score + token_score)
    })
}

fn fuzzy_score(haystack: &str, query: &str) -> Option<usize> {
    if query.is_empty() {
        return Some(0);
    }
    let haystack = haystack.to_ascii_lowercase();
    if let Some(index) = haystack.find(query) {
        return Some(index);
    }
    let mut score = 0usize;
    let mut last_match = None;
    let mut chars = haystack.char_indices();
    for query_char in query.chars() {
        let (index, _) = chars.find(|(_, haystack_char)| *haystack_char == query_char)?;
        score += last_match.map_or(index, |last| index.saturating_sub(last + 1));
        last_match = Some(index);
    }
    Some(score + haystack.len())
}

fn state_lines(panel: &DevStatePanel) -> Vec<Line<'static>> {
    let mut lines = status_block("State", &panel.status);
    if let Some(address) = &panel.address {
        lines.push(field("Address", address));
    }
    lines.push(Line::from(
        "State is read from zero-argument view/pure functions. Press r to refresh.",
    ));
    lines.push(Line::from(""));
    if panel.values.is_empty() {
        lines.push(Line::from(
            "No state values yet. Deploy the contract, or add a public variable / no-arg view.",
        ));
        return lines;
    }
    for value in &panel.values {
        lines.push(Line::from(vec![
            Span::styled(
                format!("{:<24}", value.name),
                Style::default().fg(Color::Green),
            ),
            Span::raw(state_value_display(value)),
        ]));
        lines.push(Line::from(vec![
            Span::styled("  sig  ", Style::default().fg(Color::DarkGray)),
            Span::raw(value.signature.clone()),
        ]));
        lines.push(Line::from(vec![
            Span::styled("  raw  ", Style::default().fg(Color::DarkGray)),
            Span::raw(value.raw.clone()),
        ]));
    }
    lines
}

fn event_lines(panel: &DevEventsPanel) -> Vec<Line<'static>> {
    let mut lines = status_block("Events", &panel.status);
    if let Some(address) = &panel.address {
        lines.push(field("Address", address));
    }
    lines.push(Line::from(""));
    if panel.events.is_empty() {
        lines.push(Line::from(
            "No decoded events have been seen for this deployment.",
        ));
        return lines;
    }
    for event in panel.events.iter().rev().take(12) {
        lines.push(Line::from(vec![
            Span::styled(event.label.clone(), Style::default().fg(Color::Yellow)),
            Span::raw(format!(
                "  block={}  tx={}",
                event
                    .block_number
                    .map_or("unknown".to_string(), |block| block.to_string()),
                event
                    .transaction_hash
                    .as_deref()
                    .map(short_hash)
                    .unwrap_or_else(|| "unknown".to_string())
            )),
        ]));
        for arg in event.args.iter().take(4) {
            lines.push(Line::from(format!(
                "  {} {}{} = {}",
                arg.kind,
                arg.name,
                if arg.indexed { " indexed" } else { "" },
                arg.value
            )));
        }
        if event.args.len() > 4 {
            lines.push(Line::from(format!("  +{} more args", event.args.len() - 4)));
        }
        lines.push(Line::from(""));
    }
    lines
}

fn contract_workspace_lines(
    data: &DevData,
    selected_index: usize,
    last_result: Option<&str>,
) -> Vec<Line<'static>> {
    let contract = data.contract.as_deref().unwrap_or("select contract");
    let file = data.current_file.as_deref().unwrap_or("no file selected");
    let target = data.target.as_deref().unwrap_or("-");
    let chain = data
        .network
        .chain_id
        .map_or("chain unknown".to_string(), |id| format!("chain {id}"));
    let mut lines = vec![
        Line::from(vec![
            Span::styled("CONTRACT ", Style::default().fg(Color::DarkGray)),
            Span::styled(contract.to_string(), active_title_style()),
            Span::styled("  file ", Style::default().fg(Color::DarkGray)),
            Span::raw(compact_text(file, 48)),
        ]),
        Line::from(vec![
            Span::styled("target ", Style::default().fg(Color::DarkGray)),
            Span::raw(compact_text(target, 72)),
            Span::styled("  network ", Style::default().fg(Color::DarkGray)),
            Span::raw(data.network.name.clone()),
            Span::styled(" / ", Style::default().fg(Color::DarkGray)),
            Span::raw(chain),
            Span::styled("  account ", Style::default().fg(Color::DarkGray)),
            Span::raw(data.account.name.clone()),
        ]),
        Line::from(vec![
            status_pill(
                "deploy",
                &deployment_label(&data.deployment),
                &data.deployment.status,
            ),
            Span::raw(" "),
            status_pill(
                "state",
                &state_summary_label(&data.state),
                &data.state.status.status,
            ),
            Span::raw(" "),
            status_pill("activity", &activity_summary_label(data), "ready"),
        ]),
        Line::from(vec![
            Span::styled("next   ", Style::default().fg(Color::DarkGray)),
            Span::raw(next_step_line(data)),
        ]),
        Line::from(vec![
            Span::styled("keys   ", Style::default().fg(Color::DarkGray)),
            Span::styled("Up/Down", Style::default().fg(Color::Cyan)),
            Span::raw(" move  "),
            Span::styled("b", Style::default().fg(Color::Cyan)),
            Span::raw(" build  "),
            Span::styled("d", Style::default().fg(Color::Cyan)),
            Span::raw(" deploy  "),
            Span::styled("Enter/c", Style::default().fg(Color::Cyan)),
            Span::raw(" run  "),
            Span::styled("y", Style::default().fg(Color::Cyan)),
            Span::raw(" copy  "),
            Span::styled("r", Style::default().fg(Color::Cyan)),
            Span::raw(" refresh"),
        ]),
        Line::from(""),
    ];

    lines.extend(current_file_contract_lines(data));

    if let Some(last_result) = last_result {
        lines.push(Line::from(vec![
            Span::styled("last ", Style::default().fg(Color::DarkGray)),
            Span::raw(last_result.to_string()),
        ]));
        lines.push(Line::from(""));
    }

    lines.extend(compact_abi_status_lines(data));
    if data.functions.items.is_empty() {
        lines.push(empty_state_line("No ABI functions are loaded yet."));
        lines.push(Line::from("  Press b to build, then use d to deploy."));
        return lines;
    }

    lines.push(Line::from(""));
    lines.push(Line::from(vec![
        Span::styled("Runnable ABI", active_title_style()),
        Span::styled(
            "  Up/Down move  Enter/c run  y copy CLI",
            Style::default().fg(Color::DarkGray),
        ),
    ]));
    let mut last_kind = "";
    for (index, function) in data.functions.items.iter().enumerate() {
        if function.kind != last_kind {
            last_kind = &function.kind;
            lines.push(Line::from(vec![
                Span::styled(
                    function_group_heading(data, &function.kind),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(
                    function_group_hint(&function.kind),
                    Style::default().fg(Color::DarkGray),
                ),
            ]));
        }
        lines.push(function_line(function, index == selected_index));
        if index == selected_index {
            lines.extend(selected_function_detail_lines(data, function));
        }
    }

    lines
}

fn active_title_style() -> Style {
    Style::default()
        .fg(Color::Cyan)
        .add_modifier(Modifier::BOLD)
}

fn status_pill(label: &'static str, value: &str, status: &str) -> Span<'static> {
    Span::styled(
        format!("[{label}: {}]", compact_text(value, 30)),
        status_style(status).remove_modifier(Modifier::BOLD),
    )
}

fn compact_abi_status_lines(data: &DevData) -> Vec<Line<'static>> {
    let status = &data.functions.status;
    let mut lines = vec![Line::from(vec![
        Span::styled("ABI  ", Style::default().fg(Color::DarkGray)),
        Span::styled(status.status.clone(), status_style(&status.status)),
        Span::styled("  deploy ", Style::default().fg(Color::DarkGray)),
        Span::raw(function_kind_count(data, "constructor").to_string()),
        Span::styled("  read ", Style::default().fg(Color::DarkGray)),
        Span::raw(function_kind_count(data, "read").to_string()),
        Span::styled("  write ", Style::default().fg(Color::DarkGray)),
        Span::raw(function_kind_count(data, "write").to_string()),
        Span::styled("  payable ", Style::default().fg(Color::DarkGray)),
        Span::raw(function_kind_count(data, "payable").to_string()),
    ])];
    if status.status != "ready" {
        if let Some(message) = &status.message {
            lines.push(Line::from(format!("  {message}")));
        }
        if let Some(hint) = &status.hint {
            lines.push(Line::from(vec![
                Span::styled("  hint ", Style::default().fg(Color::DarkGray)),
                Span::raw(hint.clone()),
            ]));
        }
    }
    lines
}

fn selected_function_detail_lines(data: &DevData, function: &DevFunction) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let args = if function.inputs.is_empty() {
        "no args".to_string()
    } else {
        params_label(&function.inputs)
    };
    let returns = if function.outputs.is_empty() {
        "no return".to_string()
    } else {
        params_label(&function.outputs)
    };
    lines.push(Line::from(vec![
        Span::styled("     input  ", Style::default().fg(Color::DarkGray)),
        Span::raw(args),
    ]));
    lines.push(Line::from(vec![
        Span::styled("     output ", Style::default().fg(Color::DarkGray)),
        Span::raw(returns),
    ]));
    if let Some(target) = data.target.as_deref() {
        lines.push(Line::from(vec![
            Span::styled("     cli    ", Style::default().fg(Color::DarkGray)),
            Span::raw(compact_text(&function_cli_command(target, function), 88)),
        ]));
    }
    lines
}

fn function_kind_count(data: &DevData, kind: &str) -> usize {
    data.functions
        .items
        .iter()
        .filter(|function| function.kind == kind)
        .count()
}

fn function_group_heading(data: &DevData, kind: &str) -> String {
    format!(
        "{} ({})",
        function_group_label(kind),
        function_kind_count(data, kind)
    )
}

fn empty_state_line(message: &str) -> Line<'static> {
    Line::from(vec![
        Span::styled("  - ", Style::default().fg(Color::DarkGray)),
        Span::raw(message.to_string()),
    ])
}

fn current_file_contract_lines(data: &DevData) -> Vec<Line<'static>> {
    let Some(current_file) = data.current_file.as_deref() else {
        return Vec::new();
    };
    let Some(file) = data
        .source_explorer
        .files
        .iter()
        .find(|file| file.path == current_file)
    else {
        return Vec::new();
    };
    if file.contracts.len() <= 1 {
        return Vec::new();
    }

    let contracts = file
        .contracts
        .iter()
        .map(|contract| {
            let marker = if data.target.as_deref() == Some(contract.target.as_str()) {
                "*"
            } else {
                " "
            };
            format!("{marker}{}:{}", contract.kind, contract.name)
        })
        .collect::<Vec<_>>()
        .join("  ");

    vec![
        Line::from(vec![
            Span::styled("same file ", Style::default().fg(Color::DarkGray)),
            Span::raw(format!("{} declarations", file.contracts.len())),
        ]),
        Line::from(vec![
            Span::styled("  ", Style::default().fg(Color::DarkGray)),
            Span::raw(contracts),
        ]),
        Line::from(""),
    ]
}

fn compact_state_log_lines(data: &DevData) -> Vec<Line<'static>> {
    vec![
        Line::from(vec![
            Span::styled("State  ", Style::default().fg(Color::Green)),
            Span::raw(state_summary_label(&data.state)),
            Span::styled("  Activity  ", Style::default().fg(Color::Yellow)),
            Span::raw(activity_summary_label(data)),
        ]),
        Line::from("Own writes refresh immediately; external changes use polling or r."),
    ]
}

fn state_watch_lines(data: &DevData, limit: usize) -> Vec<Line<'static>> {
    let mut lines = vec![Line::from(vec![
        Span::styled("State Watch", active_title_style()),
        Span::styled("  ", Style::default().fg(Color::DarkGray)),
        Span::raw(state_summary_label(&data.state)),
    ])];
    if data.deployment.status != "ready" {
        lines.push(Line::from(""));
        lines.push(empty_state_line(&t("state-watch-no-deploy")));
        return lines;
    }
    lines.push(Line::from(vec![
        Span::styled("source ", Style::default().fg(Color::DarkGray)),
        Span::raw("consol activity.state / consol state"),
        Span::styled("  refresh ", Style::default().fg(Color::DarkGray)),
        Span::raw("own writes + 5s poll + r"),
    ]));
    lines.push(Line::from(""));
    lines.extend(workspace_state_lines(&data.state, limit));
    lines
}

fn workspace_state_lines(state: &DevStatePanel, limit: usize) -> Vec<Line<'static>> {
    let mut lines = vec![Line::from(vec![
        Span::styled(
            "name                  ",
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled("type        ", Style::default().fg(Color::DarkGray)),
        Span::styled("value", Style::default().fg(Color::DarkGray)),
    ])];
    if state.values.is_empty() {
        lines.push(empty_state_line(&t("state-values-empty")));
        return lines;
    }
    for value in state.values.iter().take(limit) {
        let readable = value
            .readable
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&value.raw);
        let type_label = state_type_label(value);
        lines.push(Line::from(vec![
            Span::raw("  "),
            Span::styled(
                format!("{:<20}", compact_text(&value.name, 19)),
                Style::default().fg(Color::Green),
            ),
            Span::styled(
                format!("{:<12}", compact_text(&type_label, 11)),
                Style::default().fg(Color::DarkGray),
            ),
            Span::raw(compact_text(readable, 34)),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "     raw             ",
                Style::default().fg(Color::DarkGray),
            ),
            Span::raw(short_raw_value(&value.raw)),
        ]));
    }
    if state.values.len() > limit {
        lines.push(Line::from(tf(
            "state-values-more",
            &[("count", &(state.values.len() - limit).to_string())],
        )));
    }
    lines
}

fn state_value_display(value: &DevStateValue) -> String {
    let type_label = state_type_label(value);
    match value.readable.as_deref() {
        Some(readable) if !readable.trim().is_empty() => format!("{readable}  ({type_label})"),
        _ => format!("{}  ({type_label})", short_raw_value(&value.raw)),
    }
}

fn state_type_label(value: &DevStateValue) -> String {
    if value.output_types.is_empty() {
        "raw".to_string()
    } else {
        value.output_types.join(",")
    }
}

fn short_raw_value(raw: &str) -> String {
    if raw.len() <= 44 {
        raw.to_string()
    } else {
        format!("{}...{}", &raw[..18], &raw[raw.len() - 10..])
    }
}

fn compact_text(value: &str, max_chars: usize) -> String {
    let count = value.chars().count();
    if count <= max_chars {
        return value.to_string();
    }
    if max_chars <= 3 {
        return ".".repeat(max_chars);
    }
    let head_len = (max_chars - 3) / 2;
    let tail_len = max_chars - 3 - head_len;
    let head = value.chars().take(head_len).collect::<String>();
    let tail = value
        .chars()
        .rev()
        .take(tail_len)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("{head}...{tail}")
}

fn workspace_log_lines(
    data: &DevData,
    trace_result: Option<&DevTraceResult>,
    limit: usize,
    scroll_offset: usize,
    width: u16,
) -> Vec<Line<'static>> {
    let source = data
        .activity
        .as_ref()
        .map(|activity| format!("consol activity {}", compact_text(&activity.target, 46)))
        .unwrap_or_else(|| "consol activity <target>".to_string());
    let mut lines = vec![
        Line::from(vec![
            Span::styled("Activity", active_title_style()),
            Span::styled("  tx ", Style::default().fg(Color::DarkGray)),
            Span::raw(data.transactions.len().to_string()),
            Span::styled("  events ", Style::default().fg(Color::DarkGray)),
            Span::raw(data.events.events.len().to_string()),
            Span::styled("  session ", Style::default().fg(Color::DarkGray)),
            Span::raw(data.feed.len().to_string()),
        ]),
        Line::from(vec![
            Span::styled("source ", Style::default().fg(Color::DarkGray)),
            Span::raw(source),
        ]),
        Line::from(""),
    ];

    let rows = activity_log_rows(data, width);
    let offset = clamped_activity_offset(rows.len(), limit, scroll_offset);
    let visible = rows
        .iter()
        .skip(offset)
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();

    if visible.is_empty() {
        if data.deployment.status == "ready" {
            lines.push(empty_state_line(&t("contract-log-empty-ready")));
        } else {
            lines.push(empty_state_line(&t("contract-log-empty-not-ready")));
        }
    } else {
        lines.extend(visible);
        lines.push(activity_scroll_hint(rows.len(), limit, offset));
    }

    if let Some(trace_result) = trace_result {
        lines.push(Line::from(""));
        lines.extend(trace_result_lines(trace_result).into_iter().take(5));
    }

    lines
}

fn activity_visible_limit(
    area: Rect,
    trace_result: Option<&DevTraceResult>,
    kind: ActivityPanelKind,
) -> usize {
    let inner_height = area.height.saturating_sub(2) as usize;
    let trace_lines = trace_result
        .map(|trace_result| trace_result_lines(trace_result).len() + 1)
        .unwrap_or(0);
    let reserved = match kind {
        ActivityPanelKind::Compact => 4 + trace_lines,
        ActivityPanelKind::Full => 6 + trace_lines,
    };
    inner_height.saturating_sub(reserved).max(1)
}

fn compact_mixed_activity_limit(
    area: Rect,
    existing_lines: usize,
    trace_result: Option<&DevTraceResult>,
) -> usize {
    let inner_height = area.height.saturating_sub(2) as usize;
    let trace_lines = trace_result
        .map(|trace_result| trace_result_lines(trace_result).len() + 1)
        .unwrap_or(0);
    let reserved = existing_lines + 4 + trace_lines;
    inner_height.saturating_sub(reserved).max(1)
}

fn activity_log_rows(data: &DevData, width: u16) -> Vec<Line<'static>> {
    let mut rows = Vec::new();
    let width = activity_log_text_width(width);

    for transaction in data.transactions.iter().rev() {
        rows.extend(transaction_lines(transaction, width));
    }

    for event in &data.events.events {
        rows.extend(event_lines_for_activity(event, width));
    }

    for event in &data.feed {
        let color = match event.level.as_str() {
            "error" => Color::Red,
            "warn" => Color::Yellow,
            _ => Color::Green,
        };
        let prefix = vec![
            Span::styled(
                format!("[{}] ", local_time_label(Some(event.created_at_unix))),
                Style::default().fg(Color::DarkGray),
            ),
            Span::styled("session ", Style::default().fg(color)),
            Span::styled(format!("{:<5}", event.level), Style::default().fg(color)),
        ];
        let prefix_width = 11 + 8 + 5;
        push_wrapped_activity_lines(&mut rows, prefix, prefix_width, &event.message, width);
    }
    rows
}

fn activity_log_text_width(width: u16) -> usize {
    width.saturating_sub(5).max(8) as usize
}

fn transaction_lines(transaction: &tx::TransactionRecord, width: usize) -> Vec<Line<'static>> {
    let hash = transaction
        .tx_hash
        .as_deref()
        .map(short_hash)
        .unwrap_or_else(|| "tx unknown".to_string());
    let action = transaction.action.as_str();
    let detail = transaction
        .signature
        .as_deref()
        .or(transaction.address.as_deref())
        .unwrap_or("contract");
    let status = transaction
        .receipt
        .as_ref()
        .and_then(|receipt| receipt.status.as_deref())
        .unwrap_or("pending");
    let block = transaction
        .receipt
        .as_ref()
        .and_then(|receipt| receipt.block_number.as_deref())
        .unwrap_or("-");
    let gas = transaction
        .receipt
        .as_ref()
        .and_then(|receipt| receipt.gas_used.as_deref())
        .unwrap_or("-");
    let color = transaction_status_color(status);
    let prefix = vec![
        Span::styled(
            format!("[{}] ", local_time_label(Some(transaction.created_at_unix))),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled("tx ", Style::default().fg(Color::Cyan)),
    ];
    let message = format!(
        "{action:<6} {} {hash} {} status={} block={} gas={}",
        compact_text(&transaction.contract, 18),
        compact_text(detail, 32),
        status,
        block,
        gas
    );
    let mut lines = Vec::new();
    push_wrapped_activity_lines_with_message_style(
        &mut lines,
        prefix,
        14,
        &message,
        width,
        Style::default().fg(color),
    );
    lines
}

fn event_lines_for_activity(event: &DevEvent, width: usize) -> Vec<Line<'static>> {
    let prefix = vec![
        Span::styled(
            format!("[{}] ", local_time_label(None)),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled("event ", Style::default().fg(Color::Yellow)),
    ];
    let message = format!(
        "{} block={} tx={}",
        event.label,
        event
            .block_number
            .map_or("unknown".to_string(), |block| block.to_string()),
        event
            .transaction_hash
            .as_deref()
            .map(short_hash)
            .unwrap_or_else(|| "unknown".to_string())
    );
    let mut lines = Vec::new();
    push_wrapped_activity_lines(&mut lines, prefix, 17, &message, width);
    lines
}

fn push_wrapped_activity_lines(
    rows: &mut Vec<Line<'static>>,
    prefix: Vec<Span<'static>>,
    prefix_width: usize,
    message: &str,
    width: usize,
) {
    push_wrapped_activity_lines_with_message_style(
        rows,
        prefix,
        prefix_width,
        message,
        width,
        Style::default(),
    );
}

fn push_wrapped_activity_lines_with_message_style(
    rows: &mut Vec<Line<'static>>,
    prefix: Vec<Span<'static>>,
    prefix_width: usize,
    message: &str,
    width: usize,
    message_style: Style,
) {
    let first_width = width.saturating_sub(prefix_width).max(8);
    let continuation_width = width.saturating_sub(prefix_width).max(8);
    let wrapped = wrap_activity_text(message, first_width, continuation_width);
    for (index, line) in wrapped.into_iter().enumerate() {
        if index == 0 {
            let mut spans = prefix.clone();
            spans.push(Span::styled(line, message_style));
            rows.push(Line::from(spans));
        } else {
            rows.push(Line::from(vec![
                Span::raw(" ".repeat(prefix_width)),
                Span::styled(line, message_style),
            ]));
        }
    }
}

fn wrap_activity_text(message: &str, first_width: usize, continuation_width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut current_width = first_width.max(1);
    for word in message.split_whitespace() {
        push_wrapped_word(
            &mut lines,
            &mut current,
            &mut current_width,
            word,
            continuation_width,
        );
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn push_wrapped_word(
    lines: &mut Vec<String>,
    current: &mut String,
    current_width: &mut usize,
    word: &str,
    continuation_width: usize,
) {
    let mut remaining = word.to_string();
    loop {
        let separator = usize::from(!current.is_empty());
        let remaining_len = remaining.chars().count();
        let current_len = current.chars().count();
        if current_len + separator + remaining_len <= *current_width {
            if separator == 1 {
                current.push(' ');
            }
            current.push_str(&remaining);
            return;
        }

        if !current.is_empty() {
            lines.push(std::mem::take(current));
            *current_width = continuation_width.max(1);
            continue;
        }

        let take = (*current_width).min(remaining_len).max(1);
        let chunk = remaining.chars().take(take).collect::<String>();
        lines.push(chunk);
        remaining = remaining.chars().skip(take).collect::<String>();
        *current_width = continuation_width.max(1);
        if remaining.is_empty() {
            return;
        }
    }
}

fn activity_log_row_count(data: &DevData) -> usize {
    data.feed.len() + data.transactions.len() + data.events.events.len()
}

fn clamped_activity_offset(total: usize, limit: usize, offset: usize) -> usize {
    let latest_offset = total.saturating_sub(limit.max(1));
    latest_offset.saturating_sub(offset.min(latest_offset))
}

fn activity_scroll_hint(total: usize, limit: usize, offset: usize) -> Line<'static> {
    let end = (offset + limit).min(total);
    let range = if total == 0 {
        "0/0".to_string()
    } else {
        format!("{}-{end}/{total}", offset + 1)
    };
    let mode = if total <= limit || end == total {
        "following"
    } else {
        "viewing older"
    };
    Line::from(vec![
        Span::styled("     ", Style::default().fg(Color::DarkGray)),
        Span::styled("oldest -> newest", Style::default().fg(Color::DarkGray)),
        Span::raw("  "),
        Span::styled(
            activity_scroll_bar(total, limit, offset),
            Style::default().fg(Color::Cyan),
        ),
        Span::raw("  "),
        Span::styled(range, Style::default().fg(Color::DarkGray)),
        Span::raw("  "),
        Span::styled(mode, Style::default().fg(Color::DarkGray)),
        Span::raw("  "),
        Span::styled(
            "wheel up older, wheel down latest",
            Style::default().fg(Color::DarkGray),
        ),
    ])
}

fn activity_scroll_bar(total: usize, limit: usize, offset: usize) -> String {
    const WIDTH: usize = 12;
    if total == 0 {
        return "[------------]".to_string();
    }
    if total <= limit {
        return "[############]".to_string();
    }

    let track = WIDTH;
    let thumb_len = ((limit * track).div_ceil(total)).clamp(1, track);
    let max_offset = total.saturating_sub(limit.max(1));
    let max_thumb_start = track.saturating_sub(thumb_len);
    let thumb_start = (offset * max_thumb_start + max_offset / 2)
        .checked_div(max_offset)
        .unwrap_or(0);
    let mut bar = String::with_capacity(track + 2);
    bar.push('[');
    for index in 0..track {
        if index >= thumb_start && index < thumb_start + thumb_len {
            bar.push('#');
        } else {
            bar.push('-');
        }
    }
    bar.push(']');
    bar
}

fn state_summary_label(state: &DevStatePanel) -> String {
    if state.status.status != "ready" {
        return state.status.status.clone();
    }
    match state.values.len() {
        0 => "ready, no values".to_string(),
        1 => "1 value watched".to_string(),
        count => format!("{count} values watched"),
    }
}

fn activity_summary_label(data: &DevData) -> String {
    let event_count = data.events.events.len();
    let tx_count = data.transactions.len();
    if event_count == 0 && tx_count == 0 {
        return "no activity yet".to_string();
    }
    format!("{tx_count} tx, {event_count} event(s)")
}

fn next_step_line(data: &DevData) -> String {
    if data.source_explorer.files.is_empty() {
        return "add a .sol file under src/contracts/test/script or this directory.".to_string();
    }
    if data.target.is_none() {
        return "press / to choose a contract with the fuzzy picker.".to_string();
    }
    if data.functions.status.status == "artifact_missing" {
        return "press b to build the ABI, then press d to deploy.".to_string();
    }
    if data.functions.items.is_empty() {
        return "press b to build, then select a function.".to_string();
    }
    if data.deployment.status != "ready" {
        return "press Enter on any function, or d, to open the deploy preview.".to_string();
    }
    "select a function with arrow keys, press Enter/c to read or write; State updates after tx."
        .to_string()
}

fn deployment_label(status: &PanelStatus) -> String {
    match (&status.status[..], status.message.as_deref()) {
        ("ready", Some(message)) => message.to_string(),
        (_, Some(message)) => format!("{} - {}", status.status, message),
        _ => status.status.clone(),
    }
}

fn function_line(function: &DevFunction, selected: bool) -> Line<'static> {
    let color = match function.kind.as_str() {
        "read" => Color::Green,
        "payable" => Color::Magenta,
        "constructor" => Color::Cyan,
        _ => Color::Yellow,
    };
    let marker = if selected { ">" } else { " " };
    let selected_style = if selected {
        Style::default()
            .fg(Color::Black)
            .bg(Color::Cyan)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(color)
    };
    let action = match function.kind.as_str() {
        "constructor" => "deploy",
        "read" => "read",
        "payable" => "pay",
        _ => "write",
    };
    let input_count = function.inputs.len();
    let output_count = function.outputs.len();
    let io = if output_count == 0 {
        format!("{input_count} in")
    } else {
        format!("{input_count} in / {output_count} out")
    };
    Line::from(vec![
        Span::styled(marker, Style::default().fg(Color::Cyan)),
        Span::raw(" "),
        Span::styled(format!("{:<7}", action), selected_style),
        Span::styled(
            format!("{:<42}", compact_text(&function.signature, 41)),
            selected_style,
        ),
        Span::styled(
            format!(" {:<10}", function.mutability),
            if selected {
                selected_style
            } else {
                Style::default().fg(Color::DarkGray)
            },
        ),
        Span::styled(
            io,
            if selected {
                selected_style
            } else {
                Style::default().fg(Color::DarkGray)
            },
        ),
    ])
}

fn function_group_label(kind: &str) -> &'static str {
    match kind {
        "constructor" => "Deploy",
        "read" => "Read",
        "payable" => "Payable write",
        _ => "Write",
    }
}

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn local_time_label(timestamp: Option<u64>) -> String {
    let Some(timestamp) = timestamp else {
        return "--:--:--".to_string();
    };
    Local
        .timestamp_opt(timestamp as i64, 0)
        .single()
        .map(|datetime| datetime.format("%H:%M:%S").to_string())
        .unwrap_or_else(|| "--:--:--".to_string())
}

fn function_group_hint(kind: &str) -> &'static str {
    match kind {
        "constructor" => " - Enter opens deployment",
        "read" => " - Enter calls without gas",
        "payable" => " - Enter asks for value, args, then confirmation",
        _ => " - Enter previews tx, Enter/y confirms",
    }
}

fn diagnostic_lines(panel: &DevDiagnosticsPanel) -> Vec<Line<'static>> {
    let mut lines = status_block("Diagnostics", &panel.status);
    lines.push(Line::from(
        "Press b to run `consol build` and refresh diagnostics.",
    ));
    lines.push(Line::from(""));
    if panel.diagnostics.is_empty() {
        lines.push(Line::from("No diagnostics have been reported."));
        return lines;
    }

    for diagnostic in panel.diagnostics.iter().take(20) {
        let color = if diagnostic.severity == "error" {
            Color::Red
        } else {
            Color::Yellow
        };
        let location = diagnostic_location(diagnostic);
        lines.push(Line::from(vec![
            Span::styled(
                format!("{:<7}", diagnostic.severity),
                Style::default().fg(color).add_modifier(Modifier::BOLD),
            ),
            Span::raw(location),
            Span::styled(
                diagnostic
                    .code
                    .as_ref()
                    .map_or(String::new(), |code| format!("  {code}")),
                Style::default().fg(Color::DarkGray),
            ),
        ]));
        lines.push(Line::from(format!("  {}", diagnostic.message)));
    }
    if panel.diagnostics.len() > 20 {
        lines.push(Line::from(format!(
            "+{} more diagnostic(s)",
            panel.diagnostics.len() - 20
        )));
    }
    lines
}

fn diagnostic_location(diagnostic: &build::Diagnostic) -> String {
    match (&diagnostic.file, diagnostic.line, diagnostic.column) {
        (Some(file), Some(line), Some(column)) => format!("{file}:{line}:{column}"),
        (Some(file), _, _) => file.clone(),
        _ => "project".to_string(),
    }
}

fn feed_lines(
    data: &DevData,
    trace_result: Option<&DevTraceResult>,
    limit: usize,
    scroll_offset: usize,
    width: u16,
) -> Vec<Line<'static>> {
    let mut lines = vec![Line::from(vec![
        Span::styled("Activity", active_title_style()),
        Span::styled("  tx ", Style::default().fg(Color::DarkGray)),
        Span::raw(data.transactions.len().to_string()),
        Span::styled("  events ", Style::default().fg(Color::DarkGray)),
        Span::raw(data.events.events.len().to_string()),
        Span::styled("  session ", Style::default().fg(Color::DarkGray)),
        Span::raw(data.feed.len().to_string()),
    ])];
    lines.push(Line::from(
        "Durable data comes from `consol activity` / `consol tx list`.",
    ));
    lines.push(Line::from(
        "Oldest entries are at the top; new entries append at the bottom.",
    ));
    lines.push(Line::from(
        "Press t to trace latest tx. PageUp/wheel up shows older entries.",
    ));
    lines.push(Line::from(""));

    let rows = activity_log_rows(data, width);
    let offset = clamped_activity_offset(rows.len(), limit, scroll_offset);
    let visible = rows
        .iter()
        .skip(offset)
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();

    if let Some(trace_result) = trace_result {
        lines.extend(trace_result_lines(trace_result));
        lines.push(Line::from(""));
    }

    if visible.is_empty() {
        lines.push(empty_state_line("No activity recorded for this context."));
        return lines;
    }

    lines.extend(visible);
    lines.push(activity_scroll_hint(rows.len(), limit, offset));
    lines
}

fn trace_result_lines(trace_result: &DevTraceResult) -> Vec<Line<'static>> {
    let mut lines = vec![Line::from(vec![
        Span::styled("Trace       ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            short_hash(&trace_result.tx_hash),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
    ])];
    lines.push(field("Network", &trace_result.network));
    if let Some(block) = &trace_result.block_number {
        lines.push(field("Block", block));
    }
    if let Some(status) = &trace_result.status {
        lines.push(field("Status", status));
    }
    if let Some(gas) = &trace_result.gas_used {
        lines.push(field("Gas Used", gas));
    }
    if trace_result.lines.is_empty() {
        lines.push(Line::from("Trace output is empty."));
    } else {
        lines.push(Line::from("Trace preview"));
        for line in &trace_result.lines {
            lines.push(Line::from(format!("  {line}")));
        }
    }
    lines
}

fn transaction_status_color(status: &str) -> Color {
    let normalized = status.to_ascii_lowercase();
    if normalized.starts_with('1') || normalized.contains("success") {
        Color::Green
    } else if normalized.starts_with('0') || normalized.contains("revert") {
        Color::Red
    } else {
        Color::Yellow
    }
}

fn trace_latest_transaction_in_tui(cli: &Cli, app: &mut DevApp) {
    let Some(transaction) = latest_traceable_transaction(&app.data.transactions).cloned() else {
        app.status = "no traceable transaction".to_string();
        app.last_function_result = Some("No recorded transaction hash is available.".to_string());
        push_feed(app, DevFeedEvent::warn(app.status.clone()));
        return;
    };
    let Some(tx_hash) = transaction.tx_hash.as_deref() else {
        return;
    };

    if let Err(err) = ensure_trace_network_matches(&transaction, &app.data.network) {
        app.status = format!("trace blocked: {}", err.message());
        app.last_function_result = error_result(&err);
        push_feed(app, DevFeedEvent::warn(app.status.clone()));
        return;
    }

    match trace::data(cli, tx_hash) {
        Ok((data, _)) => {
            let trace_result = DevTraceResult::from_data(data);
            app.status = format!(
                "traced {} on {}",
                short_hash(&trace_result.tx_hash),
                trace_result.network
            );
            app.trace_result = Some(trace_result);
            push_feed(app, DevFeedEvent::info(app.status.clone()));
        }
        Err(err) => {
            app.status = format!("trace failed: {}", err.message());
            app.last_function_result = error_result(&err);
            push_feed(app, DevFeedEvent::error(app.status.clone()));
        }
    }
}

fn latest_traceable_transaction(
    transactions: &[tx::TransactionRecord],
) -> Option<&tx::TransactionRecord> {
    transactions
        .iter()
        .find(|transaction| transaction.tx_hash.is_some())
}

fn ensure_trace_network_matches(
    transaction: &tx::TransactionRecord,
    network: &NetworkMeta,
) -> AppResult<()> {
    if transaction.network == network.name && transaction.chain_id == network.chain_id {
        return Ok(());
    }
    Err(AppError::user(
        "trace_network_mismatch",
        format!(
            "Latest transaction was recorded on `{}` but the active network is `{}`.",
            transaction.network, network.name
        ),
        Some("Switch back to the recorded network before tracing this transaction.".to_string()),
    ))
}

fn workflow_lines(data: &DevData, selected_index: usize) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from("Help"),
        Line::from("Primary workflow stays in Contract. This tab is a runbook and CLI reference."),
        Line::from(""),
        Line::from("Core flow"),
        Line::from("  / choose contract   b build ABI   d deploy preview"),
        Line::from("  arrow keys select function Enter/c run   r refresh State/Log"),
        Line::from("  State Watch auto-reads no-arg read values every 5s after deployment."),
        Line::from(""),
        Line::from("CLI equivalents"),
        Line::from(
            "  y copies the selected command. Enter runs the matching shortcut when available.",
        ),
        Line::from(""),
    ];
    if data.commands.is_empty() {
        lines.push(Line::from("No commands are available yet."));
    } else {
        for (index, command) in data.commands.iter().enumerate() {
            let marker = if index == selected_index { ">" } else { " " };
            let enter_action = command_enter_label(&command.label);
            lines.push(Line::from(vec![
                Span::styled(marker, Style::default().fg(Color::Cyan)),
                Span::raw(" "),
                Span::styled(
                    format!("{:<10}", command.label),
                    Style::default().fg(Color::Green),
                ),
                Span::raw(command.command.clone()),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  Enter ", Style::default().fg(Color::DarkGray)),
                Span::raw(enter_action),
                Span::styled("  y ", Style::default().fg(Color::DarkGray)),
                Span::raw("copy command"),
            ]));
            lines.push(Line::from(vec![
                Span::styled("  note  ", Style::default().fg(Color::DarkGray)),
                Span::raw(command.description.clone()),
            ]));
        }
    }
    lines
}

fn command_enter_label(label: &str) -> &'static str {
    match command_action(label) {
        CommandAction::Build => "run build",
        CommandAction::Deploy => "preview deploy",
        CommandAction::State => "open State",
        CommandAction::Events => "open Events",
        CommandAction::Feed => "open Activity",
        CommandAction::Copy => "copy CLI command",
    }
}

fn field(label: &'static str, value: &str) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{label:<10}"), Style::default().fg(Color::DarkGray)),
        Span::raw(value.to_string()),
    ])
}

fn status_style(status: &str) -> Style {
    let color = match status {
        "ready" => Color::Green,
        "success" => Color::Green,
        "not_run" | "target_required" | "artifact_missing" | "deployment_not_found" => {
            Color::Yellow
        }
        _ => Color::Red,
    };
    Style::default().fg(color).add_modifier(Modifier::BOLD)
}

fn load_data(cli: &Cli, args: &TargetArgs) -> AppResult<DevData> {
    load_data_with_target(cli, args, args.target.clone())
}

fn load_data_with_target(
    cli: &Cli,
    args: &TargetArgs,
    target_override: Option<String>,
) -> AppResult<DevData> {
    let detected = detect::detect(cli, target_override.as_deref())?;
    let project_root_path = detected.project_root.as_ref().map(std::path::PathBuf::from);
    let source_root = source_scan_root(
        cli,
        target_override.as_deref(),
        project_root_path.as_deref(),
    )?;
    let source_explorer = scan_solidity_sources(&source_root, project_root_path.as_deref())?;
    let contracts = project_root_path
        .as_deref()
        .map(discover_project_contracts)
        .transpose()?
        .unwrap_or_default();
    let effective_target = target_override.or_else(|| {
        if let Some(target) = &args.target {
            return Some(target.clone());
        }
        let source_targets = deployable_source_targets(&source_explorer);
        if source_targets.len() == 1 {
            source_targets.into_iter().next()
        } else if source_targets.is_empty() {
            contracts.first().map(|contract| contract.target.clone())
        } else {
            None
        }
    });
    let resolved = effective_target
        .as_deref()
        .map(|target| target::resolve(cli, Some(target)))
        .transpose()?;
    let project_root = resolved
        .as_ref()
        .map(|target| target.project_root.display().to_string())
        .or_else(|| detected.project_root.clone());
    let source_mode = resolved
        .as_ref()
        .map(|target| target.source_mode.to_string())
        .unwrap_or_else(|| detect_source_mode(&detected.source_mode).to_string());
    let contract = resolved
        .as_ref()
        .map(|target| target.contract_name.clone())
        .filter(|contract| !contract.is_empty());
    let current_file = current_source_file(
        &source_explorer,
        effective_target.as_deref(),
        contract.as_deref(),
    )
    .or_else(|| {
        resolved
            .as_ref()
            .and_then(|target| target.source_file.as_ref())
            .map(|path| display_relative_path(path, &source_root))
    });
    let commands = dev_commands(
        effective_target.as_deref(),
        contract.as_deref(),
        &detected.network,
        &detected.account,
    );
    let functions = load_functions(resolved.as_ref());
    let (activity, deployment, state, events) =
        load_activity_panels(cli, effective_target.as_deref());
    let diagnostics = DevDiagnosticsPanel::empty(PanelStatus::info(
        "not_run",
        "Build diagnostics have not been run in this TUI session.",
        Some("Press `b` to run `consol build`.".to_string()),
    ));
    let transactions = activity
        .as_ref()
        .map(|activity| activity.transactions.clone())
        .unwrap_or_default();

    Ok(DevData {
        target: effective_target,
        current_file,
        contract,
        contracts,
        source_explorer,
        source_mode,
        project_root,
        network: detected.network,
        account: detected.account,
        tools: DevTools {
            forge: tool_label(&detected.tools.forge),
            cast: tool_label(&detected.tools.cast),
            anvil: tool_label(&detected.tools.anvil),
        },
        deployment,
        state,
        events,
        functions,
        diagnostics,
        commands,
        activity,
        feed: vec![DevFeedEvent::info("dev snapshot loaded")],
        transactions,
        panels: PANEL_TITLES
            .iter()
            .map(|title| (*title).to_string())
            .collect(),
        keymap: vec![
            KeyHint {
                key: "Tab".to_string(),
                action: "next workspace".to_string(),
            },
            KeyHint {
                key: "Shift-Tab".to_string(),
                action: "prev workspace".to_string(),
            },
            KeyHint {
                key: "/".to_string(),
                action: "find contract".to_string(),
            },
            KeyHint {
                key: "r".to_string(),
                action: "refresh state".to_string(),
            },
            KeyHint {
                key: "n".to_string(),
                action: "network".to_string(),
            },
            KeyHint {
                key: "a".to_string(),
                action: "account".to_string(),
            },
            KeyHint {
                key: "[/]".to_string(),
                action: "contract".to_string(),
            },
            KeyHint {
                key: "b".to_string(),
                action: "build".to_string(),
            },
            KeyHint {
                key: "d".to_string(),
                action: "deploy".to_string(),
            },
            KeyHint {
                key: "t".to_string(),
                action: "trace latest tx".to_string(),
            },
            KeyHint {
                key: "Up/Down".to_string(),
                action: "select".to_string(),
            },
            KeyHint {
                key: "Enter/c".to_string(),
                action: "run selected".to_string(),
            },
            KeyHint {
                key: "q/Esc".to_string(),
                action: "quit".to_string(),
            },
        ],
    })
}

fn source_scan_root(
    cli: &Cli,
    target: Option<&str>,
    project_root: Option<&Path>,
) -> AppResult<std::path::PathBuf> {
    if let Some(project_root) = project_root {
        return Ok(project_root.to_path_buf());
    }
    if let Some(project) = &cli.project {
        return Ok(project.clone());
    }
    if let Some(target) = target {
        let file = target.split_once(':').map_or(target, |(file, _)| file);
        let path = Path::new(file);
        if path.exists() {
            let source = fs::canonicalize(path)?;
            return Ok(if source.is_dir() {
                source
            } else {
                source.parent().unwrap_or(Path::new(".")).to_path_buf()
            });
        }
    }
    Ok(std::env::current_dir()?)
}

fn scan_solidity_sources(root: &Path, project_root: Option<&Path>) -> AppResult<DevSourceExplorer> {
    let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let project_root =
        project_root.map(|root| fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf()));
    let mut files = Vec::new();
    let scan_roots = solidity_scan_roots(&root);
    for scan_root in scan_roots {
        visit_solidity_sources(&scan_root, &root, project_root.as_deref(), &mut files)?;
    }
    files.sort_by(|left, right| {
        source_category_rank(&left.category)
            .cmp(&source_category_rank(&right.category))
            .then_with(|| left.path.cmp(&right.path))
    });
    files.dedup_by(|left, right| left.absolute_path == right.absolute_path);

    let contract_count = files.iter().map(|file| file.contracts.len()).sum::<usize>();
    let status = if files.is_empty() {
        PanelStatus::info(
            "empty",
            "No Solidity files were found.",
            Some(
                "Create a .sol file under src, contracts, test, script, or this directory."
                    .to_string(),
            ),
        )
    } else {
        PanelStatus::ready(format!(
            "{} Solidity file(s), {} contract declaration(s).",
            files.len(),
            contract_count
        ))
    };

    Ok(DevSourceExplorer {
        status,
        root: Some(root.display().to_string()),
        files,
    })
}

fn solidity_scan_roots(root: &Path) -> Vec<std::path::PathBuf> {
    let mut roots = Vec::new();
    for dir in ["src", "contracts", "test", "script"] {
        let candidate = root.join(dir);
        if candidate.is_dir() {
            roots.push(candidate);
        }
    }
    if has_root_solidity_files(root) || roots.is_empty() {
        roots.push(root.to_path_buf());
    }
    roots
}

fn has_root_solidity_files(root: &Path) -> bool {
    fs::read_dir(root).is_ok_and(|entries| {
        entries
            .filter_map(Result::ok)
            .any(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("sol"))
    })
}

fn visit_solidity_sources(
    dir: &Path,
    root: &Path,
    project_root: Option<&Path>,
    files: &mut Vec<DevSourceFile>,
) -> AppResult<()> {
    if should_skip_source_dir(dir) {
        return Ok(());
    }
    if dir.is_file() {
        if dir.extension().and_then(|ext| ext.to_str()) == Some("sol") {
            files.push(source_file_from_path(dir, root, project_root)?);
        }
        return Ok(());
    }
    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            visit_solidity_sources(&path, root, project_root, files)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("sol") {
            files.push(source_file_from_path(&path, root, project_root)?);
        }
    }
    Ok(())
}

fn should_skip_source_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            matches!(
                name,
                ".git"
                    | ".consol"
                    | "broadcast"
                    | "cache"
                    | "lib"
                    | "node_modules"
                    | "out"
                    | "target"
            )
        })
}

fn source_file_from_path(
    path: &Path,
    root: &Path,
    project_root: Option<&Path>,
) -> AppResult<DevSourceFile> {
    let absolute = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let relative = display_relative_path(&absolute, root);
    let category = source_category(&absolute, root);
    let contracts = source_contracts(&absolute)?
        .into_iter()
        .map(|contract| DevSourceContract {
            target: source_contract_target(&absolute, project_root, &contract.name),
            deployable: contract.kind == "contract",
            name: contract.name,
            kind: contract.kind,
        })
        .collect();
    Ok(DevSourceFile {
        path: relative,
        absolute_path: absolute.display().to_string(),
        category,
        contracts,
    })
}

#[derive(Debug, Clone)]
struct ParsedSourceContract {
    name: String,
    kind: String,
}

fn source_contracts(path: &Path) -> AppResult<Vec<ParsedSourceContract>> {
    let content = fs::read_to_string(path)?;
    let mut contracts = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim_start();
        let candidates = [
            ("abstract contract ", "contract"),
            ("contract ", "contract"),
            ("library ", "library"),
            ("interface ", "interface"),
        ];
        for (prefix, kind) in candidates {
            if let Some(rest) = trimmed.strip_prefix(prefix) {
                if let Some(name) = rest
                    .split(|ch: char| ch.is_whitespace() || ch == '{' || ch == '(' || ch == ':')
                    .find(|part| !part.is_empty())
                {
                    contracts.push(ParsedSourceContract {
                        name: name.to_string(),
                        kind: kind.to_string(),
                    });
                }
            }
        }
    }
    contracts.sort_by(|left, right| left.name.cmp(&right.name));
    contracts.dedup_by(|left, right| left.name == right.name && left.kind == right.kind);
    Ok(contracts)
}

fn source_contract_target(path: &Path, project_root: Option<&Path>, contract_name: &str) -> String {
    if project_root.is_some_and(|root| path.starts_with(root)) {
        contract_name.to_string()
    } else {
        format!("{}:{contract_name}", path.display())
    }
}

fn deployable_source_targets(explorer: &DevSourceExplorer) -> Vec<String> {
    let mut targets = explorer
        .files
        .iter()
        .flat_map(|file| &file.contracts)
        .filter(|contract| contract.deployable)
        .map(|contract| contract.target.clone())
        .collect::<Vec<_>>();
    if targets.is_empty() {
        targets = explorer
            .files
            .iter()
            .flat_map(|file| &file.contracts)
            .map(|contract| contract.target.clone())
            .collect();
    }
    targets
}

fn current_source_file(
    explorer: &DevSourceExplorer,
    target: Option<&str>,
    contract: Option<&str>,
) -> Option<String> {
    for file in &explorer.files {
        for source_contract in &file.contracts {
            if target == Some(source_contract.target.as_str())
                || contract == Some(source_contract.name.as_str())
            {
                return Some(file.path.clone());
            }
        }
    }
    None
}

fn source_category(path: &Path, root: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    match relative
        .components()
        .next()
        .and_then(|component| match component {
            std::path::Component::Normal(name) => name.to_str(),
            _ => None,
        }) {
        Some("src") => "src",
        Some("contracts") => "contracts",
        Some("test") => "test",
        Some("script") => "script",
        _ => "demo",
    }
    .to_string()
}

fn source_category_rank(category: &str) -> u8 {
    match category {
        "src" => 0,
        "contracts" => 1,
        "script" => 2,
        "test" => 3,
        "demo" => 4,
        _ => 5,
    }
}

fn display_relative_path(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}

fn discover_project_contracts(project_root: &Path) -> AppResult<Vec<DevContract>> {
    let out_dir = project_root.join("out");
    let mut contracts = Vec::new();
    visit_contract_artifacts(&out_dir, &mut |path| {
        let Some(name) = path.file_stem().and_then(|name| name.to_str()) else {
            return;
        };
        if name.is_empty() {
            return;
        }
        contracts.push(DevContract {
            name: name.to_string(),
            target: name.to_string(),
            artifact_path: path.display().to_string(),
        });
    })?;
    contracts.sort_by(|left, right| left.name.cmp(&right.name));
    contracts.dedup_by(|left, right| left.name == right.name);
    Ok(contracts)
}

fn visit_contract_artifacts(dir: &Path, visitor: &mut impl FnMut(&Path)) -> AppResult<()> {
    if !dir.exists() {
        return Ok(());
    }
    if dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "build-info")
    {
        return Ok(());
    }

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            visit_contract_artifacts(&path, visitor)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("json")
            && looks_like_contract_artifact(&path)
        {
            visitor(&path);
        }
    }
    Ok(())
}

fn looks_like_contract_artifact(path: &Path) -> bool {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .and_then(|artifact| artifact.get("abi").cloned())
        .is_some_and(|abi| abi.is_array())
}

fn load_activity_panels(
    cli: &Cli,
    target_value: Option<&str>,
) -> (
    Option<activity::ActivityData>,
    PanelStatus,
    DevStatePanel,
    DevEventsPanel,
) {
    let Some(target_value) = target_value else {
        let status = PanelStatus::info(
            "target_required",
            "Open a contract target to enable deployment, state, and event panels.",
            Some("Run `consol dev <target>`.".to_string()),
        );
        return (
            None,
            status.clone(),
            DevStatePanel::empty(status.clone()),
            DevEventsPanel::empty(status),
        );
    };

    let data = match activity::snapshot(cli, target_value, 10) {
        Ok(data) => data,
        Err(err) => {
            let status = panel_status_from_error(&err);
            return (
                None,
                status.clone(),
                DevStatePanel::empty(status.clone()),
                DevEventsPanel::empty(status),
            );
        }
    };

    let deployment = PanelStatus::from_activity(&data.deployment.status);
    let state = DevStatePanel::from_activity(&data.state);
    let events = DevEventsPanel::from_activity(&data.logs);

    (Some(data), deployment, state, events)
}

fn load_functions(resolved: Option<&target::ResolvedTarget>) -> DevFunctionsPanel {
    let Some(resolved) = resolved else {
        return DevFunctionsPanel::empty(PanelStatus::info(
            "target_required",
            "Open a contract target to inspect ABI functions.",
            Some("Run `consol dev <target>`.".to_string()),
        ));
    };

    let artifact = match target::with_scratch_lock(&resolved.project_root, || {
        let artifact_path = target::artifact_path(resolved)?;
        fs::read_to_string(&artifact_path).map_err(|err| {
            AppError::user(
                "artifact_missing",
                format!("No artifact found at {}.", artifact_path.display()),
                Some(format!("Run `consol build <target>` first. ({err})")),
            )
        })
    }) {
        Ok(content) => content,
        Err(err) => return DevFunctionsPanel::empty(panel_status_from_error(&err)),
    };
    let artifact: Value = match serde_json::from_str(&artifact) {
        Ok(artifact) => artifact,
        Err(err) => {
            return DevFunctionsPanel::empty(PanelStatus::info(
                "artifact_parse_failed",
                format!("Failed to parse artifact JSON: {err}"),
                Some("Rebuild the contract artifact.".to_string()),
            ));
        }
    };

    let mut items = abi_items(&artifact)
        .into_iter()
        .filter_map(dev_function_from_abi)
        .collect::<Vec<_>>();
    items.sort_by(|left, right| {
        function_category_rank(&left.kind)
            .cmp(&function_category_rank(&right.kind))
            .then_with(|| left.signature.cmp(&right.signature))
    });
    let status = if items.is_empty() {
        PanelStatus::ready("No ABI functions found.")
    } else {
        PanelStatus::ready(format!("{} ABI function(s) loaded.", items.len()))
    };
    DevFunctionsPanel { status, items }
}

fn dev_commands(
    target: Option<&str>,
    contract: Option<&str>,
    network: &NetworkMeta,
    account: &AccountMeta,
) -> Vec<DevCommand> {
    let target = target.or(contract).unwrap_or("<target>");
    vec![
        DevCommand::new(
            "build",
            format!("consol build {}", shell_quote(target)),
            "compile target and return parsed diagnostics",
        ),
        DevCommand::new(
            "inspect",
            format!("consol inspect {}", shell_quote(target)),
            "show ABI, bytecode, deployment, and source context",
        ),
        DevCommand::new(
            "gas",
            format!("consol gas compile {}", shell_quote(target)),
            "show compiler gas estimates for ABI functions",
        ),
        DevCommand::new(
            "deploy",
            format!(
                "consol --network {} --account {} deploy {}",
                shell_quote(&network.name),
                shell_quote(&account.name),
                shell_quote(target)
            ),
            "deploy with the current network/account context",
        ),
        DevCommand::new(
            "state",
            format!(
                "consol --network {} state {}",
                shell_quote(&network.name),
                shell_quote(target)
            ),
            "read zero-argument view/pure functions from the active deployment",
        ),
        DevCommand::new(
            "logs",
            format!(
                "consol --network {} logs {}",
                shell_quote(&network.name),
                shell_quote(target)
            ),
            "decode recent events from the active deployment",
        ),
        DevCommand::new(
            "activity",
            format!(
                "consol --network {} --account {} activity {}",
                shell_quote(&network.name),
                shell_quote(&account.name),
                shell_quote(target)
            ),
            "show the same deployment, state, events, and tx snapshot used by Activity",
        ),
        DevCommand::new(
            "tx list",
            format!("consol tx list {}", shell_quote(target)),
            "show recent deploy/send transaction history for this target",
        ),
        DevCommand::new(
            "console",
            format!(
                "consol --network {} --account {} console {}",
                shell_quote(&network.name),
                shell_quote(&account.name),
                shell_quote(target)
            ),
            "open the lightweight contract REPL",
        ),
    ]
}

fn function_cli_command(target: &str, function: &DevFunction) -> String {
    if function.kind == "constructor" {
        let args = constructor_arg_placeholders(function);
        return format!("consol deploy {}{}", shell_quote(target), args);
    }
    let command = if function.kind == "read" {
        "call"
    } else {
        "send"
    };
    let args = if function.inputs.is_empty() {
        String::new()
    } else {
        format!(
            " {}",
            function
                .inputs
                .iter()
                .map(arg_placeholder)
                .collect::<Vec<_>>()
                .join(" ")
        )
    };
    let value = if function.kind == "payable" {
        " --value <wei>"
    } else {
        ""
    };
    format!(
        "consol {command} {} {}{args}",
        shell_quote(target),
        shell_quote(&function.signature)
    ) + value
}

fn constructor_arg_placeholders(function: &DevFunction) -> String {
    if function.inputs.is_empty() {
        String::new()
    } else {
        format!(
            " {}",
            function
                .inputs
                .iter()
                .map(arg_placeholder)
                .collect::<Vec<_>>()
                .join(" ")
        )
    }
}

fn arg_placeholder(param: &AbiParam) -> String {
    let label = if param.name.is_empty() {
        param.kind.as_str()
    } else {
        param.name.as_str()
    };
    shell_quote(&format!("<{label}>"))
}

fn dev_function_from_abi(item: &Value) -> Option<DevFunction> {
    match item.get("type").and_then(Value::as_str) {
        Some("constructor") => Some(constructor_from_abi(item)),
        Some("function") => Some(function_from_abi(item)),
        _ => None,
    }
}

fn constructor_from_abi(item: &Value) -> DevFunction {
    let inputs = abi_params(item, "inputs");
    DevFunction {
        name: "constructor".to_string(),
        signature: constructor_signature(&inputs),
        mutability: item
            .get("stateMutability")
            .and_then(Value::as_str)
            .unwrap_or("nonpayable")
            .to_string(),
        kind: "constructor".to_string(),
        inputs,
        outputs: Vec::new(),
    }
}

fn function_from_abi(item: &Value) -> DevFunction {
    let name = item
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mutability = item
        .get("stateMutability")
        .and_then(Value::as_str)
        .unwrap_or("nonpayable")
        .to_string();
    let kind = match mutability.as_str() {
        "view" | "pure" => "read",
        "payable" => "payable",
        _ => "write",
    }
    .to_string();
    DevFunction {
        name,
        signature: abi_signature(item),
        mutability,
        kind,
        inputs: abi_params(item, "inputs"),
        outputs: abi_params(item, "outputs"),
    }
}

fn function_category_rank(kind: &str) -> u8 {
    match kind {
        "constructor" => 0,
        "read" => 1,
        "write" => 2,
        "payable" => 3,
        _ => 4,
    }
}

fn abi_items(artifact: &Value) -> Vec<&Value> {
    artifact
        .get("abi")
        .and_then(Value::as_array)
        .map_or_else(Vec::new, |items| items.iter().collect())
}

fn abi_signature(item: &Value) -> String {
    abi::item_signature(item)
}

fn constructor_signature(inputs: &[AbiParam]) -> String {
    let inputs = inputs
        .iter()
        .map(|input| input.kind.clone())
        .collect::<Vec<_>>()
        .join(",");
    format!("constructor({inputs})")
}

fn abi_params(item: &Value, field: &str) -> Vec<AbiParam> {
    item.get(field)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|input| AbiParam {
            name: input
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            kind: abi::param_type(input),
        })
        .collect()
}

fn params_label(params: &[AbiParam]) -> String {
    params
        .iter()
        .map(|param| {
            if param.name.is_empty() {
                param.kind.clone()
            } else {
                format!("{} {}", param.kind, param.name)
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn function_input_prompt(function: &DevFunction) -> String {
    match function.kind.as_str() {
        "payable" => {
            let args = if function.inputs.is_empty() {
                "no args".to_string()
            } else {
                params_label(&function.inputs)
            };
            format!("First enter msg.value in wei, then function args: {args}")
        }
        "read" => format!("Read call args: {}", params_label(&function.inputs)),
        _ => format!("Transaction args: {}", params_label(&function.inputs)),
    }
}

fn function_output_types(function: &DevFunction) -> Vec<String> {
    function
        .outputs
        .iter()
        .map(|output| output.kind.clone())
        .collect()
}

fn split_payable_input(mut input: Vec<String>) -> (Option<String>, Vec<String>) {
    if input.is_empty() {
        return (Some("0".to_string()), input);
    }
    let value = input.remove(0);
    let value = if value.trim().is_empty() {
        "0".to_string()
    } else {
        value
    };
    (Some(value), input)
}

fn panel_status_from_error(err: &AppError) -> PanelStatus {
    PanelStatus::info(err.code(), err.message(), err.hint())
}

impl PanelStatus {
    fn ready(message: impl Into<String>) -> Self {
        Self {
            status: "ready".to_string(),
            message: Some(message.into()),
            hint: None,
        }
    }

    fn info(
        status: impl Into<String>,
        message: impl Into<String>,
        hint: impl Into<Option<String>>,
    ) -> Self {
        Self {
            status: status.into(),
            message: Some(message.into()),
            hint: hint.into(),
        }
    }

    fn from_activity(status: &activity::ActivityStatus) -> Self {
        Self {
            status: status.status.clone(),
            message: status.message.clone(),
            hint: status.hint.clone(),
        }
    }
}

impl DevStatePanel {
    fn empty(status: PanelStatus) -> Self {
        Self {
            status,
            address: None,
            values: Vec::new(),
        }
    }

    fn from_activity(data: &activity::ActivityState) -> Self {
        Self {
            status: PanelStatus::from_activity(&data.status),
            address: data.address.clone(),
            values: data
                .values
                .iter()
                .map(|value| DevStateValue {
                    name: value.name.clone(),
                    signature: value.signature.clone(),
                    output_types: value.output_types.clone(),
                    readable: value.readable.clone(),
                    raw: value.raw.clone(),
                })
                .collect(),
        }
    }
}

impl DevEventsPanel {
    fn empty(status: PanelStatus) -> Self {
        Self {
            status,
            address: None,
            events: Vec::new(),
        }
    }

    fn from_activity(data: &activity::ActivityLogs) -> Self {
        Self {
            status: PanelStatus::from_activity(&data.status),
            address: data.address.clone(),
            events: data
                .events
                .iter()
                .map(|event| DevEvent {
                    label: event
                        .signature
                        .clone()
                        .or_else(|| event.event.clone())
                        .unwrap_or_else(|| "unknown".to_string()),
                    block_number: event.block_number,
                    transaction_hash: event.transaction_hash.clone(),
                    log_index: event.log_index,
                    args: event
                        .args
                        .iter()
                        .map(|arg| DevEventArg {
                            name: arg.name.clone(),
                            kind: arg.kind.clone(),
                            indexed: arg.indexed,
                            value: arg.value.clone(),
                        })
                        .collect(),
                })
                .collect(),
        }
    }
}

impl DevFunctionsPanel {
    fn empty(status: PanelStatus) -> Self {
        Self {
            status,
            items: Vec::new(),
        }
    }
}

impl DevDiagnosticsPanel {
    fn empty(status: PanelStatus) -> Self {
        Self {
            status,
            diagnostics: Vec::new(),
            stdout: None,
            stderr: None,
        }
    }

    fn from_build(data: build::BuildData) -> Self {
        let message = if data.diagnostics.is_empty() {
            format!("Build {} with no parsed diagnostics.", data.status)
        } else {
            format!(
                "Build {} with {} diagnostic(s).",
                data.status,
                data.diagnostics.len()
            )
        };
        Self {
            status: PanelStatus::info(data.status, message, None),
            diagnostics: data.diagnostics,
            stdout: (!data.stdout.trim().is_empty()).then_some(data.stdout),
            stderr: (!data.stderr.trim().is_empty()).then_some(data.stderr),
        }
    }
}

impl DevCommand {
    fn new(
        label: impl Into<String>,
        command: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            label: label.into(),
            command: command.into(),
            description: description.into(),
        }
    }
}

impl DevFeedEvent {
    fn info(message: impl Into<String>) -> Self {
        Self {
            level: "info".to_string(),
            message: message.into(),
            created_at_unix: current_unix_timestamp(),
        }
    }

    fn warn(message: impl Into<String>) -> Self {
        Self {
            level: "warn".to_string(),
            message: message.into(),
            created_at_unix: current_unix_timestamp(),
        }
    }

    fn error(message: impl Into<String>) -> Self {
        Self {
            level: "error".to_string(),
            message: message.into(),
            created_at_unix: current_unix_timestamp(),
        }
    }
}

impl DevTraceResult {
    fn from_data(data: trace::TraceData) -> Self {
        let lines = data
            .trace
            .lines()
            .filter(|line| !line.trim().is_empty())
            .take(12)
            .map(ToOwned::to_owned)
            .collect();
        Self {
            tx_hash: data.tx_hash,
            network: data.network,
            block_number: trace::receipt_field(&data.receipt, "blockNumber"),
            status: trace::receipt_field(&data.receipt, "status"),
            gas_used: trace::receipt_field(&data.receipt, "gasUsed"),
            lines,
        }
    }
}

impl ActionKind {
    fn label(self) -> &'static str {
        match self {
            ActionKind::Read => "call read",
            ActionKind::Write => "send write",
            ActionKind::Payable => "send payable",
            ActionKind::Deploy => "deploy",
        }
    }

    fn cache_label(self) -> &'static str {
        match self {
            ActionKind::Read => "read",
            ActionKind::Write => "write",
            ActionKind::Payable => "payable",
            ActionKind::Deploy => "deploy",
        }
    }
}

fn detect_source_mode(mode: &detect::SourceMode) -> &'static str {
    match mode {
        detect::SourceMode::Project => "project",
        detect::SourceMode::SingleFile => "single_file",
    }
}

fn tool_label(status: &detect::ToolStatus) -> String {
    if status.available {
        status
            .version
            .as_deref()
            .and_then(|version| version.lines().next())
            .unwrap_or("available")
            .to_string()
    } else {
        "missing".to_string()
    }
}

fn short_hash(value: &str) -> String {
    if value.len() <= 14 {
        value.to_string()
    } else {
        format!("{}...{}", &value[..8], &value[value.len() - 6..])
    }
}

fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | ':' | '='))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_profile_name_cycles_after_current() {
        let names = vec![
            "local".to_string(),
            "mainnet".to_string(),
            "sepolia".to_string(),
        ];

        assert_eq!(
            next_profile_name("mainnet", &names),
            Some("sepolia".to_string())
        );
        assert_eq!(
            next_profile_name("sepolia", &names),
            Some("local".to_string())
        );
    }

    #[test]
    fn next_profile_name_starts_from_first_when_current_is_unknown() {
        let names = vec!["local".to_string(), "sepolia".to_string()];

        assert_eq!(
            next_profile_name("missing", &names),
            Some("local".to_string())
        );
    }

    #[test]
    fn next_profile_candidates_keep_cycling_after_invalid_candidate() {
        let names = vec![
            "broken".to_string(),
            "local".to_string(),
            "sepolia".to_string(),
        ];

        assert_eq!(
            next_profile_candidates("sepolia", &names),
            vec![
                "broken".to_string(),
                "local".to_string(),
                "sepolia".to_string()
            ]
        );
    }

    #[test]
    fn push_unique_preserves_first_seen_order() {
        let mut names = Vec::new();

        push_unique(&mut names, "anvil0");
        push_unique(&mut names, "env");
        push_unique(&mut names, "anvil0");

        assert_eq!(names, vec!["anvil0".to_string(), "env".to_string()]);
    }

    #[test]
    fn shell_quote_leaves_safe_targets_readable() {
        assert_eq!(
            shell_quote("examples/counter-single-file/Counter.sol:Counter"),
            "examples/counter-single-file/Counter.sol:Counter"
        );
    }

    #[test]
    fn shell_quote_quotes_function_signatures_and_placeholders() {
        assert_eq!(shell_quote("setNumber(uint256)"), "'setNumber(uint256)'");
        assert_eq!(shell_quote("<newNumber>"), "'<newNumber>'");
    }

    #[test]
    fn contract_picker_keeps_j_and_k_available_for_text_input() {
        let j = KeyEvent::new(KeyCode::Char('j'), KeyModifiers::NONE);
        let k = KeyEvent::new(KeyCode::Char('k'), KeyModifiers::NONE);
        let down = KeyEvent::new(KeyCode::Down, KeyModifiers::NONE);
        let up = KeyEvent::new(KeyCode::Up, KeyModifiers::NONE);

        assert_eq!(picker_text_char(j), Some('j'));
        assert_eq!(picker_text_char(k), Some('k'));
        assert_eq!(picker_move_delta(j), None);
        assert_eq!(picker_move_delta(k), None);
        assert_eq!(picker_move_delta(down), Some(1));
        assert_eq!(picker_move_delta(up), Some(-1));
    }

    #[test]
    fn escape_does_not_quit_the_main_tui() {
        assert!(!should_quit(
            KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE),
            false
        ));
        assert!(should_quit(
            KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE),
            false
        ));
        assert!(should_quit(
            KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL),
            true
        ));
        assert_eq!(
            quit_reason(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::NONE)),
            "quit requested by q"
        );
        assert_eq!(
            quit_reason(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)),
            "quit requested by Ctrl-C"
        );
    }

    #[test]
    fn local_confirmation_accepts_enter_or_y() {
        assert!(local_confirm_key(KeyEvent::new(
            KeyCode::Enter,
            KeyModifiers::NONE
        )));
        assert!(local_confirm_key(KeyEvent::new(
            KeyCode::Char('y'),
            KeyModifiers::NONE
        )));
        assert!(!local_confirm_key(KeyEvent::new(
            KeyCode::Char('n'),
            KeyModifiers::NONE
        )));
    }

    #[test]
    fn tui_confirmation_phrase_tracks_write_policy() {
        assert_eq!(tui_confirmation_expected(&network("local", "local")), None);
        assert_eq!(
            tui_confirmation_expected(&network("sepolia", "confirm")),
            Some("yes".to_string())
        );
        assert_eq!(
            tui_confirmation_expected(&network("mainnet", "typed-confirm")),
            Some("mainnet".to_string())
        );
    }

    #[test]
    fn typed_confirmation_matches_expected_phrase() {
        let mut form = ConfirmForm::Send(send_form("sepolia"));
        assert!(!typed_confirmation_matches(Some(&form)));

        if let ConfirmForm::Send(form) = &mut form {
            form.confirmation_input = " sepolia ".to_string();
        }
        assert!(typed_confirmation_matches(Some(&form)));

        if let ConfirmForm::Send(form) = &mut form {
            form.confirmation_input = "mainnet".to_string();
        }
        assert!(!typed_confirmation_matches(Some(&form)));
    }

    #[test]
    fn changed_confirmation_context_is_rejected() {
        let err = ensure_confirmation_field("network", "sepolia", "mainnet").unwrap_err();
        assert_eq!(err.code(), "tui_confirmation_context_changed");

        let err = ensure_confirmation_chain_id(Some(11155111), Some(1)).unwrap_err();
        assert_eq!(err.code(), "tui_confirmation_context_changed");
    }

    #[test]
    fn latest_traceable_transaction_skips_records_without_hash() {
        let transactions = vec![
            transaction("local", Some(31337), None),
            transaction("local", Some(31337), Some("0xabc")),
        ];

        let latest = latest_traceable_transaction(&transactions).unwrap();
        assert_eq!(latest.tx_hash.as_deref(), Some("0xabc"));
    }

    #[test]
    fn trace_network_guard_rejects_wrong_chain() {
        let transaction = transaction("sepolia", Some(11155111), Some("0xabc"));
        let network = network("sepolia", "confirm");

        let err = ensure_trace_network_matches(&transaction, &network).unwrap_err();
        assert_eq!(err.code(), "trace_network_mismatch");
    }

    #[test]
    fn trace_result_extracts_receipt_summary_and_preview_lines() {
        let data = trace::TraceData {
            tx_hash: "0xabc".to_string(),
            network: "local".to_string(),
            chain_id: Some(31337),
            receipt: serde_json::json!({
                "blockNumber": "7",
                "status": "1",
                "gasUsed": "21000"
            }),
            trace: "\nCALL Counter.setNumber\n  SSTORE\n".to_string(),
        };

        let result = DevTraceResult::from_data(data);

        assert_eq!(result.block_number.as_deref(), Some("7"));
        assert_eq!(result.status.as_deref(), Some("1"));
        assert_eq!(result.gas_used.as_deref(), Some("21000"));
        assert_eq!(
            result.lines,
            vec!["CALL Counter.setNumber".to_string(), "  SSTORE".to_string()]
        );
    }

    #[test]
    fn source_scan_discovers_common_solidity_dirs_and_contract_targets() {
        let root = temp_dev_root("source-scan");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("script")).unwrap();
        std::fs::write(
            root.join("src/Counter.sol"),
            "pragma solidity ^0.8.20;\ncontract Counter {}\nlibrary CounterLib {}\n",
        )
        .unwrap();
        std::fs::write(
            root.join("script/Deploy.sol"),
            "pragma solidity ^0.8.20;\ncontract Deploy {}\n",
        )
        .unwrap();

        let explorer = scan_solidity_sources(&root, Some(&root)).unwrap();

        assert_eq!(explorer.files.len(), 2);
        assert_eq!(explorer.files[0].category, "src");
        assert_eq!(explorer.files[0].contracts[0].name, "Counter");
        assert_eq!(explorer.files[0].contracts[0].target, "Counter");
        assert!(explorer
            .files
            .iter()
            .any(|file| file.path == "script/Deploy.sol"));
    }

    #[test]
    fn source_scan_supports_single_file_demo_targets_without_project_root() {
        let root = temp_dev_root("single-file-source-scan");
        let source = root.join("Counter.sol");
        std::fs::write(&source, "pragma solidity ^0.8.20;\ncontract Counter {}\n").unwrap();

        let explorer = scan_solidity_sources(&root, None).unwrap();

        assert_eq!(explorer.files.len(), 1);
        assert_eq!(explorer.files[0].category, "demo");
        assert_eq!(
            explorer.files[0].contracts[0].target,
            format!("{}:Counter", source.canonicalize().unwrap().display())
        );
        assert_eq!(
            deployable_source_targets(&explorer)
                .first()
                .map(String::as_str),
            Some(explorer.files[0].contracts[0].target.as_str())
        );
    }

    #[test]
    fn contract_picker_fuzzy_search_matches_contract_names_and_paths() {
        let explorer = DevSourceExplorer {
            status: PanelStatus::ready("ready"),
            root: Some("/tmp/project".to_string()),
            files: vec![
                DevSourceFile {
                    path: "src/Counter.sol".to_string(),
                    absolute_path: "/tmp/project/src/Counter.sol".to_string(),
                    category: "src".to_string(),
                    contracts: vec![DevSourceContract {
                        name: "Counter".to_string(),
                        kind: "contract".to_string(),
                        target: "Counter".to_string(),
                        deployable: true,
                    }],
                },
                DevSourceFile {
                    path: "script/DeployCounter.s.sol".to_string(),
                    absolute_path: "/tmp/project/script/DeployCounter.s.sol".to_string(),
                    category: "script".to_string(),
                    contracts: vec![DevSourceContract {
                        name: "DeployCounter".to_string(),
                        kind: "contract".to_string(),
                        target: "DeployCounter".to_string(),
                        deployable: true,
                    }],
                },
            ],
        };
        let deploy_matches = contract_picker_entries(&explorer, "deploy");
        assert_eq!(
            deploy_matches[0].contract_name.as_deref(),
            Some("DeployCounter")
        );
        let fuzzy_matches = contract_picker_entries(&explorer, "sccntr");
        assert_eq!(fuzzy_matches[0].contract_name.as_deref(), Some("Counter"));
        let path_matches = contract_picker_entries(&explorer, "scr dep");
        assert_eq!(
            path_matches[0].contract_name.as_deref(),
            Some("DeployCounter")
        );
        assert!(contract_picker_entries(&explorer, "missing").is_empty());
    }

    #[test]
    fn abi_items_are_classified_for_tui_function_workspace() {
        let artifact = serde_json::json!({
            "abi": [
                {"type": "constructor", "inputs": [{"name": "initial", "type": "uint256"}]},
                {"type": "function", "name": "number", "stateMutability": "view", "inputs": [], "outputs": [{"name": "", "type": "uint256"}]},
                {"type": "function", "name": "setNumber", "stateMutability": "nonpayable", "inputs": [{"name": "value", "type": "uint256"}], "outputs": []},
                {"type": "function", "name": "fund", "stateMutability": "payable", "inputs": [], "outputs": []}
            ]
        });
        let mut functions = abi_items(&artifact)
            .into_iter()
            .filter_map(dev_function_from_abi)
            .collect::<Vec<_>>();
        functions.sort_by(|left, right| {
            function_category_rank(&left.kind)
                .cmp(&function_category_rank(&right.kind))
                .then_with(|| left.signature.cmp(&right.signature))
        });

        assert_eq!(
            functions
                .iter()
                .map(|function| function.kind.as_str())
                .collect::<Vec<_>>(),
            vec!["constructor", "read", "write", "payable"]
        );
        assert_eq!(functions[0].signature, "constructor(uint256)");
        assert_eq!(functions[3].signature, "fund()");
    }

    #[test]
    fn payable_input_splits_value_from_function_args() {
        let (value, args) =
            split_payable_input(vec!["1000000000000000000".to_string(), "alice".to_string()]);

        assert_eq!(value.as_deref(), Some("1000000000000000000"));
        assert_eq!(args, vec!["alice".to_string()]);
        assert_eq!(split_payable_input(Vec::new()).0.as_deref(), Some("0"));
    }

    #[test]
    fn layout_mode_tracks_wide_short_and_narrow_terminals() {
        assert_eq!(
            dev_layout_mode(Rect::new(0, 0, 140, 40)),
            DevLayoutMode::Wide
        );
        assert_eq!(
            dev_layout_mode(Rect::new(0, 0, 120, 18)),
            DevLayoutMode::Short
        );
        assert_eq!(
            dev_layout_mode(Rect::new(0, 0, 72, 40)),
            DevLayoutMode::Narrow
        );
    }

    #[test]
    fn narrow_tabs_use_compact_labels() {
        let panels = PANEL_TITLES
            .iter()
            .map(|title| (*title).to_string())
            .collect::<Vec<_>>();
        let all_indexes = visible_panel_indexes(DevLayoutMode::Narrow);
        let wide_indexes = visible_panel_indexes(DevLayoutMode::Wide);

        assert_eq!(tab_titles(72, &panels, &all_indexes)[0], "Info");
        assert_eq!(tab_titles(72, &panels, &all_indexes)[3], "Run");
        assert_eq!(tab_titles(120, &panels, &all_indexes)[3], "Contract");
        assert_eq!(tab_titles(140, &panels, &wide_indexes)[0], "Overview");
        assert!(!tab_titles(140, &panels, &wide_indexes).contains(&"Sources".to_string()));
        assert_eq!(selected_tab_index(FUNCTIONS_PANEL_INDEX, &wide_indexes), 3);
    }

    #[test]
    fn pane_focus_hit_testing_matches_contract_layout() {
        let panel = active_panel_area(Rect::new(0, 0, 140, 40));
        assert_eq!(
            contract_pane_focus_at(panel, panel.x + 2, panel.y + 2),
            Some(DevPaneFocus::ContractFunctions)
        );
        assert_eq!(
            contract_pane_focus_at(panel, panel.x + 90, panel.y + 2),
            Some(DevPaneFocus::ContractState)
        );
        assert_eq!(
            contract_pane_focus_at(panel, panel.x + 90, panel.y + 20),
            Some(DevPaneFocus::ContractActivity)
        );
    }

    #[test]
    fn default_panel_focus_keeps_tab_and_pane_focus_separate() {
        assert_eq!(
            default_focus_for_panel(FUNCTIONS_PANEL_INDEX),
            DevPaneFocus::ContractFunctions
        );
        assert_eq!(
            default_focus_for_panel(FEED_PANEL_INDEX),
            DevPaneFocus::Activity
        );
        assert_eq!(
            default_focus_for_panel(STATE_PANEL_INDEX),
            DevPaneFocus::Main
        );
    }

    #[test]
    fn input_cache_keys_are_scoped_to_target_action_and_signature() {
        assert_eq!(
            input_cache_key("Counter", ActionKind::Write, "setNumber(uint256)"),
            input_cache_key("Counter", ActionKind::Write, "setNumber(uint256)")
        );
        assert_ne!(
            input_cache_key("Counter", ActionKind::Write, "setNumber(uint256)"),
            input_cache_key("Counter", ActionKind::Write, "increment()")
        );
        assert_ne!(
            input_cache_key("Counter", ActionKind::Write, "setNumber(uint256)"),
            input_cache_key("Counter", ActionKind::Read, "setNumber(uint256)")
        );
    }

    #[test]
    fn input_form_rows_describe_order_types_and_examples() {
        let form = ActionInputForm {
            action: ActionKind::Write,
            signature: "add(string,string)".to_string(),
            prompt: "Transaction args: string _name, string _bio".to_string(),
            params: vec![
                AbiParam {
                    name: "_name".to_string(),
                    kind: "string".to_string(),
                },
                AbiParam {
                    name: "_bio".to_string(),
                    kind: "string".to_string(),
                },
            ],
            text: String::new(),
            cache_key: None,
            output_types: Vec::new(),
            error: None,
        };
        let rows = input_param_rows(&form);

        assert_eq!(expected_input_count(&form), 2);
        assert_eq!(rows[0].index, 1);
        assert_eq!(rows[0].name, "_name");
        assert_eq!(rows[0].kind, "string");
        assert!(rows[0].format.contains("quote"));
        assert!(!rows[0].format.contains("Alice"));
        assert!(input_arg_count_message(&form, 1).contains("_bio string"));
    }

    #[test]
    fn payable_input_form_counts_value_before_function_args() {
        let form = ActionInputForm {
            action: ActionKind::Payable,
            signature: "fund(string)".to_string(),
            prompt: "First enter msg.value in wei, then function args: string memo".to_string(),
            params: vec![AbiParam {
                name: "memo".to_string(),
                kind: "string".to_string(),
            }],
            text: String::new(),
            cache_key: None,
            output_types: Vec::new(),
            error: None,
        };
        let rows = input_param_rows(&form);

        assert_eq!(expected_input_count(&form), 2);
        assert_eq!(rows[0].name, "value");
        assert_eq!(rows[0].kind, "wei");
        assert_eq!(rows[1].name, "memo");
    }

    #[test]
    fn abi_input_rules_explain_numbers_and_tuples_without_semantic_examples() {
        assert!(abi_input_rule("uint256").contains("no padding"));
        assert!(abi_input_rule("(string,uint256)").contains("ABI field order"));
        assert!(abi_input_rule("(address,uint256)[]").contains("ABI field order"));
        assert!(!abi_input_rule("string").contains("Alice"));
    }

    #[test]
    fn tuple_function_signatures_use_canonical_abi_types() {
        let artifact = serde_json::json!({
            "abi": [{
                "type": "function",
                "name": "addProfile",
                "stateMutability": "nonpayable",
                "inputs": [{
                    "name": "profile",
                    "type": "tuple",
                    "components": [
                        {"name": "name", "type": "string"},
                        {"name": "score", "type": "uint256"}
                    ]
                }],
                "outputs": []
            }]
        });

        let function = abi_items(&artifact)
            .into_iter()
            .filter_map(dev_function_from_abi)
            .next()
            .expect("function");

        assert_eq!(function.signature, "addProfile((string,uint256))");
        assert_eq!(function.inputs[0].kind, "(string,uint256)");
    }

    #[test]
    fn command_actions_make_build_and_deploy_executable() {
        assert_eq!(command_action("build"), CommandAction::Build);
        assert_eq!(command_action("deploy"), CommandAction::Deploy);
        assert_eq!(command_action("state"), CommandAction::State);
        assert_eq!(command_action("logs"), CommandAction::Events);
        assert_eq!(command_action("activity"), CommandAction::Feed);
        assert_eq!(command_action("tx list"), CommandAction::Feed);
        assert_eq!(command_action("inspect"), CommandAction::Copy);
    }

    #[test]
    fn function_actions_route_to_deploy_when_contract_is_not_deployed() {
        let data = minimal_dev_data(PanelStatus::info(
            "deployment_not_found",
            "No deployment found.",
            None,
        ));
        let read = DevFunction {
            name: "number".to_string(),
            signature: "number()".to_string(),
            mutability: "view".to_string(),
            kind: "read".to_string(),
            inputs: Vec::new(),
            outputs: vec![AbiParam {
                name: String::new(),
                kind: "uint256".to_string(),
            }],
        };
        let constructor = DevFunction {
            name: "constructor".to_string(),
            signature: "constructor()".to_string(),
            mutability: "nonpayable".to_string(),
            kind: "constructor".to_string(),
            inputs: Vec::new(),
            outputs: Vec::new(),
        };

        assert!(function_needs_deployment(&data, &read));
        assert!(!function_needs_deployment(&data, &constructor));

        let mut deployed = data.clone();
        deployed.deployment = PanelStatus::ready("0x1 is deployed.");
        assert!(!function_needs_deployment(&deployed, &read));
    }

    #[test]
    fn state_watch_guides_deploy_then_lists_watched_values() {
        let data = minimal_dev_data(PanelStatus::info(
            "deployment_not_found",
            "No deployment found.",
            None,
        ));
        let lines = format!("{:?}", state_watch_lines(&data, 4));
        assert!(lines.contains("No deployment yet"));

        let mut deployed = minimal_dev_data(PanelStatus::ready("0x1 is deployed."));
        deployed.state = DevStatePanel {
            status: PanelStatus::ready("1 reader value loaded."),
            address: Some("0x0000000000000000000000000000000000000001".to_string()),
            values: vec![DevStateValue {
                name: "number".to_string(),
                signature: "number()".to_string(),
                output_types: vec!["uint256".to_string()],
                readable: Some("42".to_string()),
                raw: "42".to_string(),
            }],
        };

        let lines = format!("{:?}", state_watch_lines(&deployed, 4));
        assert!(lines.contains("number"));
        assert!(lines.contains("42"));
        assert_eq!(state_summary_label(&deployed.state), "1 value watched");
    }

    #[test]
    fn state_values_show_readable_and_short_raw_forms() {
        let value = DevStateValue {
            name: "number".to_string(),
            signature: "number()".to_string(),
            output_types: vec!["uint256".to_string()],
            readable: Some("42".to_string()),
            raw: "0x000000000000000000000000000000000000000000000000000000000000002a".to_string(),
        };

        assert_eq!(state_value_display(&value), "42  (uint256)");
        assert!(short_raw_value(&value.raw).contains("..."));
    }

    #[test]
    fn contract_workspace_uses_cockpit_style_action_rows() {
        let mut data = minimal_dev_data(PanelStatus::ready("0x1 is deployed."));
        data.functions = DevFunctionsPanel {
            status: PanelStatus::ready("2 ABI function(s) loaded."),
            items: vec![
                DevFunction {
                    name: "number".to_string(),
                    signature: "number()".to_string(),
                    mutability: "view".to_string(),
                    kind: "read".to_string(),
                    inputs: Vec::new(),
                    outputs: vec![AbiParam {
                        name: String::new(),
                        kind: "uint256".to_string(),
                    }],
                },
                DevFunction {
                    name: "setNumber".to_string(),
                    signature: "setNumber(uint256)".to_string(),
                    mutability: "nonpayable".to_string(),
                    kind: "write".to_string(),
                    inputs: vec![AbiParam {
                        name: "newNumber".to_string(),
                        kind: "uint256".to_string(),
                    }],
                    outputs: Vec::new(),
                },
            ],
        };

        let lines = format!("{:?}", contract_workspace_lines(&data, 1, None));

        assert!(lines.contains("CONTRACT"));
        assert!(lines.contains("READ (1)") || lines.contains("Read (1)"));
        assert!(lines.contains("WRITE (1)") || lines.contains("Write (1)"));
        assert!(lines.contains("input"));
        assert!(lines.contains("cli"));
    }

    #[test]
    fn compact_text_keeps_head_and_tail_visible() {
        assert_eq!(compact_text("short", 10), "short");
        assert_eq!(
            compact_text("abcdefghijklmnopqrstuvwxyz", 12),
            "abcd...vwxyz"
        );
    }

    #[test]
    fn workspace_log_combines_transactions_events_and_feed() {
        let mut data = minimal_dev_data(PanelStatus::ready("0x1 is deployed."));
        data.transactions = vec![transaction(
            "local",
            Some(31337),
            Some("0xabcdefabcdefabcdef"),
        )];
        data.events = DevEventsPanel {
            status: PanelStatus::ready("1 decoded event loaded."),
            address: Some("0x0000000000000000000000000000000000000001".to_string()),
            events: vec![DevEvent {
                label: "NumberChanged(uint256)".to_string(),
                block_number: Some(7),
                transaction_hash: Some("0xabcdefabcdefabcdef".to_string()),
                log_index: Some(0),
                args: Vec::new(),
            }],
        };
        data.feed = vec![DevFeedEvent::info("deployed Counter")];

        let lines = format!("{:?}", workspace_log_lines(&data, None, 6, 0, 100));

        assert!(lines.contains("setNumber"));
        assert!(lines.contains("NumberChanged"));
        assert!(lines.contains("deployed Counter"));
        assert_eq!(activity_summary_label(&data), "1 tx, 1 event(s)");
    }

    #[test]
    fn activity_lines_can_scroll_to_older_entries() {
        let mut data = minimal_dev_data(PanelStatus::ready("0x1 is deployed."));
        data.feed = vec![
            DevFeedEvent::info("old event"),
            DevFeedEvent::info("middle event"),
            DevFeedEvent::info("new event"),
        ];

        let latest = format!("{:?}", workspace_log_lines(&data, None, 1, 0, 100));
        let older = format!("{:?}", workspace_log_lines(&data, None, 1, 2, 100));

        assert!(latest.contains("new event"));
        assert!(older.contains("old event"));
        assert!(latest.contains("oldest -> newest"));
        assert!(latest.contains("following"));
        assert!(older.contains("viewing older"));
        assert!(latest.contains("["));
    }

    #[test]
    fn activity_scroll_bar_moves_from_top_to_bottom() {
        assert_eq!(activity_scroll_bar(3, 8, 0), "[############]");
        assert_eq!(activity_scroll_bar(24, 6, 0), "[###---------]");
        assert_eq!(activity_scroll_bar(24, 6, 18), "[---------###]");
    }

    #[test]
    fn activity_scroll_delta_saturates_instead_of_overflowing() {
        assert_eq!(
            next_activity_scroll(usize::MAX - 1, 3, usize::MAX),
            usize::MAX
        );
        assert_eq!(next_activity_scroll(5, -3, 100), 2);
        assert_eq!(next_activity_scroll(2, -3, 100), 0);
        assert_eq!(next_activity_scroll(4, 10, 8), 8);
    }

    #[test]
    fn activity_visible_limit_accounts_for_panel_height() {
        assert_eq!(
            activity_visible_limit(Rect::new(0, 0, 80, 10), None, ActivityPanelKind::Compact),
            4
        );
        assert_eq!(
            activity_visible_limit(Rect::new(0, 0, 80, 10), None, ActivityPanelKind::Full),
            2
        );
        assert_eq!(
            compact_mixed_activity_limit(Rect::new(0, 0, 80, 10), 4, None),
            1
        );
    }

    #[test]
    fn activity_rows_wrap_long_messages_and_include_time() {
        let mut data = minimal_dev_data(PanelStatus::ready("0x1 is deployed."));
        data.feed = vec![DevFeedEvent {
            level: "info".to_string(),
            message: "this is a deliberately long activity message that should wrap instead of being truncated".to_string(),
            created_at_unix: 1,
        }];

        let rows = activity_log_rows(&data, 44);
        let rendered = format!("{rows:?}");

        assert!(rows.len() > 1);
        assert!(rendered.contains("["));
        assert!(rendered.contains(":"));
        assert!(rendered.contains("deliberately"));
        assert!(rendered.contains("truncated"));
    }

    fn network(name: &str, write_policy: &str) -> NetworkMeta {
        NetworkMeta {
            name: name.to_string(),
            kind: "remote".to_string(),
            chain_id: Some(1),
            rpc_url: "https://rpc.example".to_string(),
            fork_url: None,
            fork_block_number: None,
            fingerprint: None,
            write_policy: write_policy.to_string(),
        }
    }

    fn send_form(expected: &str) -> SendConfirmForm {
        SendConfirmForm {
            target: "Counter".to_string(),
            signature: "setNumber(uint256)".to_string(),
            args: vec!["1".to_string()],
            value: None,
            address: "0x0000000000000000000000000000000000000001".to_string(),
            network: "sepolia".to_string(),
            chain_id: Some(11155111),
            write_policy: "typed-confirm".to_string(),
            account: "deployer".to_string(),
            gas_estimate: None,
            signer_address: Some("0x0000000000000000000000000000000000000002".to_string()),
            nonce: None,
            gas_price: None,
            calldata_hash: None,
            calldata_prefix: None,
            confirmation_expected: Some(expected.to_string()),
            confirmation_input: String::new(),
        }
    }

    fn minimal_dev_data(deployment: PanelStatus) -> DevData {
        let state_status = deployment.clone();
        DevData {
            target: Some("Counter".to_string()),
            current_file: Some("src/Counter.sol".to_string()),
            contract: Some("Counter".to_string()),
            contracts: Vec::new(),
            source_explorer: DevSourceExplorer {
                status: PanelStatus::ready("ready"),
                root: None,
                files: Vec::new(),
            },
            source_mode: "project".to_string(),
            project_root: None,
            network: network("local", "local"),
            account: AccountMeta {
                name: "deployer".to_string(),
                address: Some("0x0000000000000000000000000000000000000002".to_string()),
                signer: "private-key".to_string(),
            },
            tools: DevTools {
                forge: "available".to_string(),
                cast: "available".to_string(),
                anvil: "available".to_string(),
            },
            deployment,
            state: DevStatePanel::empty(state_status.clone()),
            events: DevEventsPanel::empty(state_status),
            functions: DevFunctionsPanel::empty(PanelStatus::ready("ABI ready")),
            diagnostics: DevDiagnosticsPanel::empty(PanelStatus::ready("clean")),
            commands: Vec::new(),
            activity: None,
            feed: Vec::new(),
            transactions: Vec::new(),
            panels: PANEL_TITLES
                .iter()
                .map(|title| (*title).to_string())
                .collect(),
            keymap: Vec::new(),
        }
    }

    fn transaction(
        network: &str,
        chain_id: Option<u64>,
        tx_hash: Option<&str>,
    ) -> tx::TransactionRecord {
        tx::TransactionRecord {
            id: "id".to_string(),
            action: "send".to_string(),
            contract: "Counter".to_string(),
            target: Some("Counter".to_string()),
            address: Some("0x0000000000000000000000000000000000000001".to_string()),
            function: Some("setNumber".to_string()),
            signature: Some("setNumber(uint256)".to_string()),
            args: vec!["1".to_string()],
            value: None,
            gas_estimate: None,
            gas_estimate_error: None,
            tx_hash: tx_hash.map(ToOwned::to_owned),
            receipt: None,
            network: network.to_string(),
            chain_id,
            network_fingerprint: None,
            account: "deployer".to_string(),
            from: Some("0x0000000000000000000000000000000000000002".to_string()),
            signer_address: Some("0x0000000000000000000000000000000000000002".to_string()),
            to: Some("0x0000000000000000000000000000000000000001".to_string()),
            nonce: None,
            gas_price: None,
            calldata_hash: None,
            calldata_prefix: None,
            created_at_unix: 1,
        }
    }

    fn temp_dev_root(label: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir()
            .join("consol-dev-tests")
            .join(format!("{label}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }
}
