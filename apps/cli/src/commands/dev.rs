use crate::cli::{Cli, DeployArgs, TargetArgs};
use crate::commands::{build, deploy, detect, interact, target};
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
    diagnostics: DevDiagnosticsPanel,
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
struct DevDiagnosticsPanel {
    status: PanelStatus,
    diagnostics: Vec<build::Diagnostic>,
    stdout: Option<String>,
    stderr: Option<String>,
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
    selected_function: usize,
    last_function_result: Option<String>,
    input_form: Option<ActionInputForm>,
    confirm_form: Option<ConfirmForm>,
}

#[derive(Debug, Clone)]
struct ActionInputForm {
    action: ActionKind,
    signature: String,
    prompt: String,
    text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActionKind {
    Read,
    Write,
    Deploy,
}

#[derive(Debug, Clone)]
enum ConfirmForm {
    Send(SendConfirmForm),
    Deploy(DeployConfirmForm),
}

#[derive(Debug, Clone)]
struct SendConfirmForm {
    signature: String,
    args: Vec<String>,
    address: String,
    network: String,
    account: String,
    gas_estimate: Option<String>,
}

#[derive(Debug, Clone)]
struct DeployConfirmForm {
    target: String,
    contract: String,
    args: Vec<String>,
    network: String,
    account: String,
}

const PANEL_TITLES: [&str; 6] = [
    "Status",
    "State",
    "Events",
    "Functions",
    "Diagnostics",
    "Commands",
];
const FUNCTIONS_PANEL_INDEX: usize = 3;
const DIAGNOSTICS_PANEL_INDEX: usize = 4;

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
        selected_function: 0,
        last_function_result: None,
        input_form: None,
        confirm_form: None,
    };

    loop {
        terminal.draw(|frame| render(frame, &app))?;
        if !event::poll(Duration::from_millis(250))? {
            continue;
        }

        if let Event::Key(key) = event::read()? {
            let modal_active = app.input_form.is_some() || app.confirm_form.is_some();
            if should_quit(key, modal_active) {
                break;
            }
            handle_key(key, cli, args, &mut app);
        }
    }

    Ok(())
}

fn handle_key(key: KeyEvent, cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    if app.confirm_form.is_some() {
        handle_confirm_key(key, cli, args, app);
        return;
    }
    if app.input_form.is_some() {
        handle_input_key(key, cli, args, app);
        return;
    }

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
                clamp_selected_function(app);
                app.status = "refreshed".to_string();
            }
            Err(err) => {
                app.status = format!("refresh failed: {}", err.message());
            }
        },
        KeyCode::Down | KeyCode::Char('j') if app.active_panel == FUNCTIONS_PANEL_INDEX => {
            move_selected_function(app, 1);
        }
        KeyCode::Up | KeyCode::Char('k') if app.active_panel == FUNCTIONS_PANEL_INDEX => {
            move_selected_function(app, -1);
        }
        KeyCode::Enter | KeyCode::Char('c') if app.active_panel == FUNCTIONS_PANEL_INDEX => {
            call_selected_function(cli, args, app);
        }
        KeyCode::Char('d') => {
            start_deploy_action(cli, args, app);
        }
        KeyCode::Char('b') => {
            run_build_in_tui(cli, args, app);
        }
        _ => {}
    }
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
            }
        }
        KeyCode::Char(ch) => {
            if let Some(form) = &mut app.input_form {
                form.text.push(ch);
            }
        }
        _ => {}
    }
}

fn call_selected_function(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(target_value) = args.target.as_deref() else {
        app.status = "open a target first".to_string();
        return;
    };
    let Some(function) = app.data.functions.items.get(app.selected_function) else {
        app.status = "no function selected".to_string();
        return;
    };
    let signature = function.signature.clone();
    if !function.inputs.is_empty() {
        app.status = format!("input args for {signature}");
        app.input_form = Some(ActionInputForm {
            action: if function.kind == "read" {
                ActionKind::Read
            } else {
                ActionKind::Write
            },
            signature: signature.clone(),
            prompt: format!("args: {}", params_label(&function.inputs)),
            text: String::new(),
        });
        return;
    }

    if function.kind == "read" {
        call_function_with_args(cli, target_value, app, &signature, Vec::new());
    } else {
        prepare_send_confirmation(cli, target_value, app, &signature, Vec::new());
    }
}

fn submit_input_form(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(target_value) = args.target.as_deref() else {
        app.input_form = None;
        app.status = "open a target first".to_string();
        return;
    };
    let Some(form) = app.input_form.take() else {
        return;
    };
    let function_args = match shell_words(&form.text) {
        Ok(args) => args,
        Err(err) => {
            app.status = "invalid args".to_string();
            app.last_function_result = Some(err);
            return;
        }
    };
    match form.action {
        ActionKind::Read => {
            call_function_with_args(cli, target_value, app, &form.signature, function_args);
        }
        ActionKind::Write => {
            prepare_send_confirmation(cli, target_value, app, &form.signature, function_args);
        }
        ActionKind::Deploy => {
            prepare_deploy_confirmation(cli, target_value, app, function_args);
        }
    }
}

fn call_function_with_args(
    cli: &Cli,
    target_value: &str,
    app: &mut DevApp,
    signature: &str,
    function_args: Vec<String>,
) {
    match interact::context(cli, target_value)
        .and_then(|context| interact::call_raw(&context, signature, &function_args))
    {
        Ok(raw) => {
            app.status = format!("called {signature}");
            app.last_function_result = Some(format!("{signature} -> {raw}"));
        }
        Err(err) => {
            app.status = format!("call failed: {}", err.message());
            app.last_function_result = err.hint().map_or_else(
                || Some(err.message()),
                |hint| Some(format!("{} Hint: {}", err.message(), hint)),
            );
        }
    }
}

fn start_deploy_action(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(target_value) = args.target.as_deref() else {
        app.status = "open a target first".to_string();
        return;
    };

    match constructor_inputs(cli, target_value) {
        Ok((contract, inputs)) => {
            if inputs.is_empty() {
                prepare_deploy_confirmation(cli, target_value, app, Vec::new());
            } else {
                app.status = format!("input constructor args for {contract}");
                app.input_form = Some(ActionInputForm {
                    action: ActionKind::Deploy,
                    signature: format!("deploy {contract}"),
                    prompt: format!("constructor args: {}", params_label(&inputs)),
                    text: String::new(),
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
    deploy::run_forge_build(&resolved.project_root)?;
    let artifact_path = target::artifact_path(&resolved)?;
    let artifact: Value = serde_json::from_str(&fs::read_to_string(&artifact_path)?)?;
    let inputs = abi_items(&artifact)
        .into_iter()
        .find(|item| item.get("type").and_then(Value::as_str) == Some("constructor"))
        .map_or_else(Vec::new, |item| abi_params(item, "inputs"));
    Ok((resolved.contract_name, inputs))
}

fn prepare_send_confirmation(
    cli: &Cli,
    target_value: &str,
    app: &mut DevApp,
    signature: &str,
    function_args: Vec<String>,
) {
    match interact::context(cli, target_value) {
        Ok(context) => {
            if context.network.write_policy != "local" {
                app.status = "remote write blocked in TUI".to_string();
                app.last_function_result = Some(format!(
                    "{signature} targets network `{}` with write_policy `{}`. Use `consol send` for the current remote confirmation flow.",
                    context.network.name, context.network.write_policy
                ));
                return;
            }

            let gas_estimate = interact::estimate_gas(
                &context.address,
                signature,
                &function_args,
                None,
                &context.network.rpc_url,
                context.account.address.as_deref(),
            )
            .ok();

            app.status = format!("confirm send {signature}");
            app.confirm_form = Some(ConfirmForm::Send(SendConfirmForm {
                signature: signature.to_string(),
                args: function_args,
                address: context.address,
                network: context.network.name,
                account: context.account.name,
                gas_estimate,
            }));
        }
        Err(err) => {
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
            if network.write_policy != "local" {
                app.status = "remote deploy blocked in TUI".to_string();
                app.last_function_result = Some(format!(
                    "deploy {} targets network `{}` with write_policy `{}`. Use `consol deploy` for the current remote confirmation flow.",
                    resolved.contract_name, network.name, network.write_policy
                ));
                return;
            }

            app.status = format!("confirm deploy {}", resolved.contract_name);
            app.confirm_form = Some(ConfirmForm::Deploy(DeployConfirmForm {
                target: target_value.to_string(),
                contract: resolved.contract_name,
                args: constructor_args,
                network: network.name,
                account: account.name,
            }));
        }
        Err(err) => {
            app.status = format!("deploy preview failed: {}", err.message());
            app.last_function_result = error_result(&err);
        }
    }
}

fn handle_confirm_key(key: KeyEvent, cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    match key.code {
        KeyCode::Char('y') | KeyCode::Char('Y') => match app.confirm_form.as_ref() {
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

fn send_confirmed_function(cli: &Cli, args: &TargetArgs, app: &mut DevApp) {
    let Some(target_value) = args.target.as_deref() else {
        app.confirm_form = None;
        app.status = "open a target first".to_string();
        return;
    };
    let Some(ConfirmForm::Send(form)) = app.confirm_form.take() else {
        return;
    };

    let result = interact::context(cli, target_value).and_then(|context| {
        if context.network.write_policy != "local" {
            return Err(AppError::user(
                "remote_tui_write_blocked",
                format!(
                    "TUI send is only enabled for local networks. `{}` uses write_policy `{}`.",
                    context.network.name, context.network.write_policy
                ),
                Some("Use `consol send` for the current remote confirmation flow.".to_string()),
            ));
        }
        let private_key = crate::config::private_key_for_write(cli, &context.network)?;
        interact::send_raw(&context, &form.signature, &form.args, None, &private_key)
    });

    match result {
        Ok(tx_output) => {
            let result = tx_summary(&tx_output)
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
        if network.write_policy != "local" {
            return Err(AppError::user(
                "remote_tui_deploy_blocked",
                format!(
                    "TUI deploy is only enabled for local networks. `{}` uses write_policy `{}`.",
                    network.name, network.write_policy
                ),
                Some("Use `consol deploy` for the current remote confirmation flow.".to_string()),
            ));
        }
        deploy::execute(
            cli,
            &DeployArgs {
                target: form.target.clone(),
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
    match load_data(cli, args) {
        Ok(data) => {
            app.data = data;
            app.active_panel = 0;
            clamp_selected_function(app);
            app.status = status;
        }
        Err(err) => {
            app.status = format!("{status}; refresh failed: {}", err.message());
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
    match load_data(cli, args) {
        Ok(data) => {
            app.data = data;
            app.active_panel = FUNCTIONS_PANEL_INDEX;
            clamp_selected_function(app);
            app.status = format!("sent {signature}");
        }
        Err(err) => {
            app.status = format!("sent {signature}; refresh failed: {}", err.message());
        }
    }
}

fn tx_summary(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let line = line.trim();
        if line.starts_with("transactionHash") {
            line.split_whitespace().last().map(ToOwned::to_owned)
        } else {
            None
        }
    })
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
    match build::build_data(cli, args.target.as_deref()) {
        Ok(data) => {
            let status = data.status.clone();
            let count = data.diagnostics.len();
            app.data.diagnostics = DevDiagnosticsPanel::from_build(data);
            app.active_panel = DIAGNOSTICS_PANEL_INDEX;
            app.status = if count == 0 {
                format!("build {status}")
            } else {
                format!("build {status}: {count} diagnostic(s)")
            };
        }
        Err(err) => {
            app.data.diagnostics = DevDiagnosticsPanel::empty(panel_status_from_error(&err));
            app.active_panel = DIAGNOSTICS_PANEL_INDEX;
            app.status = format!("build failed: {}", err.message());
        }
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

fn should_quit(key: KeyEvent, input_active: bool) -> bool {
    (!input_active && (key.code == KeyCode::Esc || key.code == KeyCode::Char('q')))
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
    render_input_form(frame, area, app);
    render_confirm_form(frame, area, app);
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
            function_lines(
                &app.data.functions,
                app.selected_function,
                app.last_function_result.as_deref(),
            ),
        ),
        4 => render_text_panel(
            frame,
            area,
            "diagnostics",
            diagnostic_lines(&app.data.diagnostics),
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

fn render_input_form(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    let Some(form) = &app.input_form else {
        return;
    };
    let input_area = centered_rect(area, 82, 7);
    let lines = vec![
        Line::from(format!("Action: {}", form.action.label())),
        Line::from(form.signature.clone()),
        Line::from(form.prompt.clone()),
        Line::from(vec![
            Span::styled("> ", Style::default().fg(Color::Green)),
            Span::raw(form.text.clone()),
            Span::styled(" ", Style::default().bg(Color::Cyan)),
        ]),
        Line::from("Use whitespace-separated args; quote strings with \"...\" or '...'."),
    ];
    frame.render_widget(Clear, input_area);
    frame.render_widget(
        Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title("action args"))
            .wrap(Wrap { trim: false }),
        input_area,
    );
}

fn render_confirm_form(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
    match &app.confirm_form {
        Some(ConfirmForm::Send(form)) => render_send_confirm_form(frame, area, form),
        Some(ConfirmForm::Deploy(form)) => render_deploy_confirm_form(frame, area, form),
        None => {}
    }
}

fn render_send_confirm_form(frame: &mut Frame<'_>, area: Rect, form: &SendConfirmForm) {
    let input_area = centered_rect(area, 82, 10);
    let args = if form.args.is_empty() {
        "<none>".to_string()
    } else {
        form.args.join(" ")
    };
    let gas = form.gas_estimate.as_deref().unwrap_or("unavailable");
    let lines = vec![
        Line::from("Local transaction preview"),
        field("Network", &form.network),
        field("Account", &form.account),
        field("To", &form.address),
        field("Function", &form.signature),
        field("Args", &args),
        field("Gas", gas),
        Line::from("Press y to send, n or Esc to cancel."),
    ];
    frame.render_widget(Clear, input_area);
    frame.render_widget(
        Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title("send"))
            .wrap(Wrap { trim: false }),
        input_area,
    );
}

fn render_deploy_confirm_form(frame: &mut Frame<'_>, area: Rect, form: &DeployConfirmForm) {
    let input_area = centered_rect(area, 82, 9);
    let args = if form.args.is_empty() {
        "<none>".to_string()
    } else {
        form.args.join(" ")
    };
    let lines = vec![
        Line::from("Local deployment preview"),
        field("Network", &form.network),
        field("Account", &form.account),
        field("Contract", &form.contract),
        field("Target", &form.target),
        field("Args", &args),
        Line::from("Press y to deploy, n or Esc to cancel."),
    ];
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
        "y confirm   n/Esc cancel   Ctrl-C quit".to_string()
    } else if app.input_form.is_some() {
        "Enter submit   Esc cancel   Backspace delete   Ctrl-C quit".to_string()
    } else {
        app.data
            .keymap
            .iter()
            .map(|hint| format!("{} {}", hint.key, hint.action))
            .collect::<Vec<_>>()
            .join("   ")
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

fn function_lines(
    panel: &DevFunctionsPanel,
    selected_index: usize,
    last_result: Option<&str>,
) -> Vec<Line<'static>> {
    let mut lines = status_block("Functions", &panel.status);
    lines.push(Line::from(
        "Use j/k to select; Enter or c opens read/write actions. Args open an input sheet.",
    ));
    if let Some(last_result) = last_result {
        lines.push(Line::from(vec![
            Span::styled("Last  ", Style::default().fg(Color::DarkGray)),
            Span::raw(last_result.to_string()),
        ]));
    }
    lines.push(Line::from(""));
    if panel.items.is_empty() {
        lines.push(Line::from("No ABI functions are available."));
        return lines;
    }
    for (index, function) in panel.items.iter().enumerate() {
        let color = if function.kind == "read" {
            Color::Green
        } else {
            Color::Yellow
        };
        let marker = if index == selected_index { ">" } else { " " };
        lines.push(Line::from(vec![
            Span::styled(marker, Style::default().fg(Color::Cyan)),
            Span::raw(" "),
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
        Line::from("  1-6 jump to a panel"),
        Line::from("  b run build diagnostics"),
        Line::from("  d deploy target on local network"),
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
        "success" => Color::Green,
        "not_run" | "target_required" | "artifact_missing" | "deployment_not_found" => {
            Color::Yellow
        }
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
    let diagnostics = DevDiagnosticsPanel::empty(PanelStatus::info(
        "not_run",
        "Build diagnostics have not been run in this TUI session.",
        Some("Press `b` to run `consol build`.".to_string()),
    ));

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
        diagnostics,
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
                key: "1-6".to_string(),
                action: "jump".to_string(),
            },
            KeyHint {
                key: "r".to_string(),
                action: "refresh".to_string(),
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
                key: "j/k".to_string(),
                action: "select function".to_string(),
            },
            KeyHint {
                key: "Enter".to_string(),
                action: "action".to_string(),
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

impl ActionKind {
    fn label(self) -> &'static str {
        match self {
            ActionKind::Read => "call read",
            ActionKind::Write => "send write",
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
