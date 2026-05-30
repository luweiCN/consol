use crate::cli::{Cli, TargetArgs};
use crate::commands::{detect, target};
use crate::error::AppResult;
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
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};
use ratatui::{Frame, Terminal};
use serde::Serialize;
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
struct KeyHint {
    key: String,
    action: String,
}

#[derive(Debug)]
struct DevApp {
    data: DevData,
    status: String,
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
    let mut terminal = setup_terminal()?;
    let _guard = TerminalGuard;
    let mut app = DevApp {
        data,
        status: "ready".to_string(),
    };

    loop {
        terminal.draw(|frame| render(frame, &app))?;
        if !event::poll(Duration::from_millis(250))? {
            continue;
        }

        match event::read()? {
            Event::Key(key) if should_quit(key) => break,
            Event::Key(key) if key.code == KeyCode::Char('r') => match load_data(cli, args) {
                Ok(data) => {
                    app.data = data;
                    app.status = "refreshed".to_string();
                }
                Err(err) => {
                    app.status = format!("refresh failed: {}", err.message());
                }
            },
            _ => {}
        }
    }

    Ok(())
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
            Constraint::Min(12),
            Constraint::Length(3),
        ])
        .split(area);

    render_header(frame, root[0], app);
    render_body(frame, root[1], app);
    render_footer(frame, root[2], app);
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
        "{} / {} / {}",
        app.data.network.name, app.data.account.name, app.status
    );
    frame.render_widget(
        Paragraph::new(vec![title, Line::from(subtitle)])
            .block(Block::default().borders(Borders::ALL).title("dev")),
        area,
    );
}

fn render_body(frame: &mut Frame<'_>, area: Rect, app: &DevApp) {
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
        Paragraph::new(workflow_lines(&app.data))
            .block(Block::default().borders(Borders::ALL).title("workflow"))
            .wrap(Wrap { trim: false }),
        columns[1],
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
        field("forge", &data.tools.forge),
        field("cast", &data.tools.cast),
        field("anvil", &data.tools.anvil),
    ]
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
        Line::from(""),
        Line::from("Panels planned next"),
        Line::from(format!("  {}", data.panels.join(" / "))),
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
        .or(detected.project_root);
    let source_mode = resolved
        .as_ref()
        .map(|target| target.source_mode.to_string())
        .unwrap_or_else(|| detect_source_mode(&detected.source_mode).to_string());
    let contract = resolved.map(|target| target.contract_name);

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
        panels: vec![
            "Status".to_string(),
            "Contracts".to_string(),
            "Deploy".to_string(),
            "Functions".to_string(),
            "Events".to_string(),
            "Diagnostics".to_string(),
        ],
        keymap: vec![
            KeyHint {
                key: "r".to_string(),
                action: "refresh".to_string(),
            },
            KeyHint {
                key: "q".to_string(),
                action: "quit".to_string(),
            },
            KeyHint {
                key: "Esc".to_string(),
                action: "quit".to_string(),
            },
        ],
    })
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
