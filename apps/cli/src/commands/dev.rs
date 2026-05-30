use crate::cli::{Cli, TargetArgs};
use crate::commands::{detect, interact, target};
use crate::error::{AppError, AppResult};
use crate::output::{self, AccountMeta, Meta, NetworkMeta};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Tabs, Wrap};
use ratatui::{Frame, Terminal};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::{self, Stdout};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
struct DevData {
    target: Option<String>,
    contract: Option<String>,
    source_mode: String,
    project_root: Option<String>,
    network: NetworkMeta,
    account: AccountMeta,
    tools: DevTools,
    deployment: PanelStatus,
    state: DevStatePanel,
    events: DevEventsPanel,
    functions: DevFunctionsPanel,
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
struct KeyHint {
    key: String,
    action: String,
}

#[derive(Debug)]
struct DevApp {
    data: DevData,
    status: String,
    active_panel: usize,
}

const PANEL_TITLES: [&str; 5] = ["Status", "State", "Events", "Functions", "Commands"];

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
    let mut terminal = setup_terminal()?;
    let _guard = TerminalGuard;
    let mut app = DevApp {
        data,
        status: "ready".to_string(),
        active_panel: 0,
    };

    loop {
        terminal.draw(|frame| render(frame, &app))?;
        if !event::poll(Duration::from_millis(250))? {
            continue;
        }

        if let Event::Key(key) = event::read()? {
            if should_quit(key) {
                break;
            }
            handle_key(key, cli, args, &mut app);
        }
    }

    Ok(())
}

fn handle_key(key: KeyEvent, cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    match key.code {
        KeyCode::Tab => {
            app.active_panel = (app.active_panel + 1) % app.data.panels.len();
            app.status = format!("panel: {}", app.data.panels[app.active_panel]);
        }
        KeyCode::BackTab => {
            app.active_panel =
                (app.active_panel + app.data.panels.len() - 1) % app.data.panels.len();
            app.status = format!("panel: {}", app.data.panels[app.active_panel]);
        }
        KeyCode::Char(ch) if ('1'..='9').contains(&ch) => {
            let index = ch as usize - '1' as usize;
            if index < app.data.panels.len() {
                app.active_panel = index;
                app.status = format!("panel: {}", app.data.panels[app.active_panel]);
            }
        }
        KeyCode::Char('r') => match load_data(cli, args) {
            Ok(data) => {
                app.data = data;
                app.active_panel = app.active_panel.min(app.data.panels.len() - 1);
                app.status = "refreshed".to_string();
            }
            Err(err) => {
                app.status = format!("refresh failed: {}", err.message());
            }
        },
        _ => {}
    }
}

fn setup_terminal() -> io::Result<Terminal<CrosstermBackend<Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    Terminal::new(backend)
}

struct TerminalGuard;

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen);
    }
}

fn should_quit(key: KeyEvent) -> bool {
    key.code == KeyCode::Esc
        || key.code == KeyCode::Char('q')
        || (key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL))
}

fn render(frame: &mut Frame<'_>, app: &DevApp) {
    let area = frame.area();
    frame.render_widget(Clear, area);

    let root = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(4),
            Constraint::Length(3),
            Constraint::Min(10),
            Constraint::Length(3),
        ])
        .split(area);

    render_header(frame, root[0], app);
    render_tabs(frame, root[1], app);
    render_panel(frame, root[2], app);
    render_footer(frame, root[3], app);
}

fn render_header(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    let title = Line::from(vec![
        Span::styled(
            "ConSol",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" - smart contract console"),
    ]);
    let subtitle = format!(
        "{} / {} / {} / {}",
        app.data.network.name, app.data.account.name, app.data.panels[app.active_panel], app.status
    );
    frame.render_widget(
        Paragraph::new(vec![title, Line::from(subtitle)])
            .block(Block::default().borders(Borders::ALL).title("dev")),
        area,
    );
}

fn render_tabs(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    let titles = app
        .data
        .panels
        .iter()
        .map(|title| Line::from(title.clone()))
        .collect::<Vec<_>>();
    frame.render_widget(
        Tabs::new(titles)
            .block(Block::default().borders(Borders::ALL).title("panels"))
            .select(app.active_panel)
            .style(Style::default().fg(Color::Gray))
            .highlight_style(
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
        area,
    );
}

fn render_panel(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    match app.active_panel {
        0 => render_status_panel(frame, area, app),
        1 => render_text_panel(frame, area, "state", state_lines(&app.data.state)),
        2 => render_text_panel(frame, area, "events", event_lines(&app.data.events)),
        3 => render_text_panel(
            frame,
            area,
            "functions",
            function_lines(&app.data.functions),
        ),
        _ => render_text_panel(frame, area, "commands", workflow_lines(&app.data)),
    }
}

fn render_status_panel(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
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

fn render_text_panel(
    frame: &mut Frame<'_>,
    area: Rect,
    title: &'static str,
    lines: Vec<Line<'static>>,
) {
    frame.render_widget(
        Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title(title))
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn render_footer(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    let hints = app
        .data
        .keymap
        .iter()
        .map(|hint| format!("{} {}", hint.key, hint.action))
        .collect::<Vec<_>>()
        .join("   ");
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
        field("Source", &data.source_mode),
        field(
            "Project",
            data.project_root.as_deref().unwrap_or("not found"),
        ),
        field("Network", &data.network.name),
        field("RPC", &data.network.rpc_url),
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

fn state_lines(panel: &DevStatePanel) -> Vec<Line<'static>> {
    let mut lines = status_block("State", &panel.status);
    if let Some(address) = &panel.address {
        lines.push(field("Address", address));
    }
    lines.push(Line::from(""));
    if panel.values.is_empty() {
        lines.push(Line::from("No zero-argument read values are available."));
        return lines;
    }
    for value in &panel.values {
        lines.push(Line::from(vec![
            Span::styled(
                format!("{:<24}", value.name),
                Style::default().fg(Color::Green),
            ),
            Span::raw(value.raw.clone()),
        ]));
        lines.push(Line::from(vec![
            Span::styled("  sig ", Style::default().fg(Color::DarkGray)),
            Span::raw(value.signature.clone()),
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

fn function_lines(panel: &DevFunctionsPanel) -> Vec<Line<'static>> {
    let mut lines = status_block("Functions", &panel.status);
    lines.push(Line::from(""));
    if panel.items.is_empty() {
        lines.push(Line::from("No ABI functions are available."));
        return lines;
    }
    for function in &panel.items {
        let color = if function.kind == "read" {
            Color::Green
        } else {
            Color::Yellow
        };
        lines.push(Line::from(vec![
            Span::styled(format!("{:<5}", function.kind), Style::default().fg(color)),
            Span::raw(function.signature.clone()),
            Span::styled(
                format!("  {}", function.mutability),
                Style::default().fg(Color::DarkGray),
            ),
        ]));
        if !function.inputs.is_empty() {
            lines.push(Line::from(format!(
                "  args: {}",
                params_label(&function.inputs)
            )));
        }
        if !function.outputs.is_empty() {
            lines.push(Line::from(format!(
                "  returns: {}",
                params_label(&function.outputs)
            )));
        }
    }
    lines
}

fn workflow_lines(data: &DevData) -> Vec<Line<'static>> {
    let target = data
        .target
        .as_deref()
        .or(data.contract.as_deref())
        .unwrap_or("<target>");
    vec![
        Line::from("Immediate commands"),
        Line::from(""),
        command(format!("consol build {target}")),
        command(format!("consol inspect {target}")),
        command(format!("consol gas compile {target}")),
        command(format!("consol deploy {target} --yes")),
        command(format!("consol state {target}")),
        command(format!("consol logs {target}")),
        command(format!("consol console {target}")),
        Line::from(""),
        Line::from("TUI keys"),
        Line::from("  Tab / Shift-Tab switch panels"),
        Line::from("  1-5 jump to a panel"),
        Line::from("  r refresh live data"),
    ]
}

fn field(label: &'static str, value: &str) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{label:<10}"), Style::default().fg(Color::DarkGray)),
        Span::raw(value.to_string()),
    ])
}

fn command(value: String) -> Line<'static> {
    Line::from(vec![
        Span::styled("  $ ", Style::default().fg(Color::Green)),
        Span::raw(value),
    ])
}

fn status_style(status: &str) -> Style {
    let color = match status {
        "ready" => Color::Green,
        "target_required" | "artifact_missing" | "deployment_not_found" => Color::Yellow,
        _ => Color::Red,
    };
    Style::default().fg(color).add_modifier(Modifier::BOLD)
}

fn load_data(cli: &Cli, args: &TargetArgs) -> AppResult<DevData> {
    let detected = detect::detect(cli, args.target.as_deref())?;
    let resolved = args
        .target
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
    let functions = load_functions(resolved.as_ref());
    let (deployment, state, events) = load_live_panels(cli, args.target.as_deref());

    Ok(DevData {
        target: args.target.clone(),
        contract,
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
        panels: PANEL_TITLES
            .iter()
            .map(|title| (*title).to_string())
            .collect(),
        keymap: vec![
            KeyHint {
                key: "Tab".to_string(),
                action: "next panel".to_string(),
            },
            KeyHint {
                key: "1-5".to_string(),
                action: "jump".to_string(),
            },
            KeyHint {
                key: "r".to_string(),
                action: "refresh".to_string(),
            },
            KeyHint {
                key: "q/Esc".to_string(),
                action: "quit".to_string(),
            },
        ],
    })
}

fn load_live_panels(
    cli: &Cli,
    target_value: Option<&str>,
) -> (PanelStatus, DevStatePanel, DevEventsPanel) {
    let Some(target_value) = target_value else {
        let status = PanelStatus::info(
            "target_required",
            "Open a contract target to enable deployment, state, and event panels.",
            Some("Run `consol dev <target>`.".to_string()),
        );
        return (
            status.clone(),
            DevStatePanel::empty(status.clone()),
            DevEventsPanel::empty(status),
        );
    };

    let context = match interact::context(cli, target_value) {
        Ok(context) => context,
        Err(err) => {
            let status = panel_status_from_error(&err);
            return (
                status.clone(),
                DevStatePanel::empty(status.clone()),
                DevEventsPanel::empty(status),
            );
        }
    };

    let deployment = PanelStatus::ready(format!("{} is deployed.", context.address));
    let state = match interact::state_snapshot(&context) {
        Ok(data) => DevStatePanel::from_state(data),
        Err(err) => DevStatePanel::empty(panel_status_from_error(&err)),
    };
    let events = match interact::logs_snapshot(&context) {
        Ok(data) => DevEventsPanel::from_logs(data),
        Err(err) => DevEventsPanel::empty(panel_status_from_error(&err)),
    };

    (deployment, state, events)
}

fn load_functions(resolved: Option<&target::ResolvedTarget>) -> DevFunctionsPanel {
    let Some(resolved) = resolved else {
        return DevFunctionsPanel::empty(PanelStatus::info(
            "target_required",
            "Open a contract target to inspect ABI functions.",
            Some("Run `consol dev <target>`.".to_string()),
        ));
    };

    let artifact_path = match target::artifact_path(resolved) {
        Ok(path) => path,
        Err(err) => return DevFunctionsPanel::empty(panel_status_from_error(&err)),
    };
    let artifact = match fs::read_to_string(&artifact_path) {
        Ok(content) => content,
        Err(_) => {
            return DevFunctionsPanel::empty(PanelStatus::info(
                "artifact_missing",
                format!("No artifact found at {}.", artifact_path.display()),
                Some("Run `consol build <target>` first.".to_string()),
            ));
        }
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
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("function"))
        .map(function_from_abi)
        .collect::<Vec<_>>();
    items.sort_by(|left, right| left.signature.cmp(&right.signature));
    let status = if items.is_empty() {
        PanelStatus::ready("No ABI functions found.")
    } else {
        PanelStatus::ready(format!("{} ABI function(s) loaded.", items.len()))
    };
    DevFunctionsPanel { status, items }
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

fn abi_items(artifact: &Value) -> Vec<&Value> {
    artifact
        .get("abi")
        .and_then(Value::as_array)
        .map_or_else(Vec::new, |items| items.iter().collect())
}

fn abi_signature(item: &Value) -> String {
    let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
    let inputs = abi_params(item, "inputs")
        .into_iter()
        .map(|input| input.kind)
        .collect::<Vec<_>>()
        .join(",");
    format!("{name}({inputs})")
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
            kind: input
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
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
}

impl DevStatePanel {
    fn empty(status: PanelStatus) -> Self {
        Self {
            status,
            address: None,
            values: Vec::new(),
        }
    }

    fn from_state(data: interact::StateData) -> Self {
        let message = if data.values.is_empty() {
            "No zero-argument read functions found.".to_string()
        } else {
            format!("{} reader value(s) loaded.", data.values.len())
        };
        Self {
            status: PanelStatus::ready(message),
            address: Some(data.address),
            values: data
                .values
                .into_iter()
                .map(|value| DevStateValue {
                    name: value.name,
                    signature: value.signature,
                    raw: value.raw,
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

    fn from_logs(data: interact::LogsData) -> Self {
        let message = if data.events.is_empty() {
            "No logs found for this deployment.".to_string()
        } else {
            format!("{} decoded event(s) loaded.", data.events.len())
        };
        Self {
            status: PanelStatus::ready(message),
            address: Some(data.address),
            events: data
                .events
                .into_iter()
                .map(|event| DevEvent {
                    label: event
                        .signature
                        .or(event.event)
                        .unwrap_or_else(|| "unknown".to_string()),
                    block_number: event.block_number,
                    transaction_hash: event.transaction_hash,
                    log_index: event.log_index,
                    args: event
                        .args
                        .into_iter()
                        .map(|arg| DevEventArg {
                            name: arg.name,
                            kind: arg.kind,
                            indexed: arg.indexed,
                            value: arg.value,
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
