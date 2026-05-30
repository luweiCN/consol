local M = {}

local config = {
  command = "consol",
  auto = true,
  diagnostics = true,
  gas_virtual_text = true,
  contract = nil,
}

local diagnostic_ns = vim.api.nvim_create_namespace("consol.nvim.diagnostics")
local gas_ns = vim.api.nvim_create_namespace("consol.nvim.gas")

local handle_result
local apply_hints
local diagnostic_matches_file
local diagnostic_severity
local normalize_bufnr

M.last_result = nil
M.last_error = nil

function M.setup(opts)
  config = vim.tbl_deep_extend("force", config, opts or {})

  vim.api.nvim_create_user_command("ConsolHints", function(command_opts)
    local contract = command_opts.args ~= "" and command_opts.args or nil
    M.refresh(0, { contract = contract })
  end, {
    nargs = "?",
    desc = "Refresh ConSol diagnostics and gas hints for the current Solidity buffer",
  })

  vim.api.nvim_create_user_command("ConsolClear", function()
    M.clear(0)
  end, {
    desc = "Clear ConSol diagnostics and gas hints for the current buffer",
  })

  if config.auto then
    local group = vim.api.nvim_create_augroup("consol_nvim", { clear = true })
    vim.api.nvim_create_autocmd({ "BufWritePost", "FileType" }, {
      group = group,
      pattern = { "*.sol", "solidity" },
      callback = function(event)
        M.refresh(event.buf)
      end,
    })
  end
end

function M.refresh(bufnr, opts)
  bufnr = normalize_bufnr(bufnr)
  opts = opts or {}
  local file = vim.api.nvim_buf_get_name(bufnr)
  if file == "" or not file:match("%.sol$") then
    return
  end

  local command = { config.command, "--json", "hints", "--file", file }
  local contract = opts.contract or config.contract
  if contract and contract ~= "" then
    vim.list_extend(command, { "--contract", contract })
  end

  M.last_result = nil
  M.last_error = nil
  vim.system(command, { text = true }, function(result)
    vim.schedule(function()
      handle_result(bufnr, file, result)
    end)
  end)
end

function M.clear(bufnr)
  bufnr = normalize_bufnr(bufnr)
  vim.diagnostic.reset(diagnostic_ns, bufnr)
  vim.api.nvim_buf_clear_namespace(bufnr, gas_ns, 0, -1)
end

function M._diagnostics_for_buffer(envelope, file)
  local diagnostics = {}
  local data = envelope.data or {}
  for _, item in ipairs(data.diagnostics or {}) do
    if diagnostic_matches_file(item, file) then
      table.insert(diagnostics, {
        lnum = math.max((item.line or 1) - 1, 0),
        col = math.max((item.column or 1) - 1, 0),
        severity = diagnostic_severity(item.severity),
        source = "consol",
        code = item.code,
        message = item.message or "ConSol diagnostic",
      })
    end
  end
  return diagnostics
end

function M._gas_hints(envelope)
  local hints = {}
  local data = envelope.data or {}
  for _, item in ipairs(data.gas_hints or {}) do
    if item.line then
      table.insert(hints, {
        line = item.line,
        message = item.message or ("gas: " .. tostring(item.gas)),
      })
    end
  end
  return hints
end

function M._config()
  return vim.deepcopy(config)
end

function M._command_for_buffer(bufnr, opts)
  bufnr = normalize_bufnr(bufnr)
  local file = vim.api.nvim_buf_get_name(bufnr)
  local command = { config.command, "--json", "hints", "--file", file }
  local contract = opts and opts.contract or config.contract
  if contract and contract ~= "" then
    vim.list_extend(command, { "--contract", contract })
  end
  return command
end

function handle_result(bufnr, file, result)
  if not vim.api.nvim_buf_is_valid(bufnr) then
    return
  end

  if result.code ~= 0 then
    M.last_error = result.stderr ~= "" and result.stderr or result.stdout
    vim.notify(M.last_error, vim.log.levels.ERROR, { title = "ConSol" })
    return
  end

  local ok, envelope = pcall(vim.json.decode, result.stdout)
  if not ok then
    M.last_error = "Failed to parse ConSol JSON output."
    vim.notify(M.last_error, vim.log.levels.ERROR, { title = "ConSol" })
    return
  end

  if envelope.ok == false then
    local error_body = envelope.error or {}
    M.last_error = error_body.message or "ConSol hints failed."
    vim.notify(M.last_error, vim.log.levels.WARN, { title = "ConSol" })
    return
  end

  M.last_result = envelope
  M.last_error = nil
  apply_hints(bufnr, file, envelope)
end

function apply_hints(bufnr, file, envelope)
  M.clear(bufnr)

  if config.diagnostics then
    vim.diagnostic.set(diagnostic_ns, bufnr, M._diagnostics_for_buffer(envelope, file), {})
  end

  if config.gas_virtual_text then
    for _, hint in ipairs(M._gas_hints(envelope)) do
      local line = hint.line - 1
      if line >= 0 and line < vim.api.nvim_buf_line_count(bufnr) then
        vim.api.nvim_buf_set_extmark(bufnr, gas_ns, line, 0, {
          virt_text = { { " " .. hint.message, "ConsolGasHint" } },
          virt_text_pos = "eol",
        })
      end
    end
  end
end

function diagnostic_matches_file(item, file)
  if not item.file then
    return true
  end
  return vim.fs.basename(item.file) == vim.fs.basename(file)
end

function diagnostic_severity(severity)
  if severity == "error" then
    return vim.diagnostic.severity.ERROR
  end
  if severity == "warning" then
    return vim.diagnostic.severity.WARN
  end
  return vim.diagnostic.severity.INFO
end

function normalize_bufnr(bufnr)
  if bufnr == nil or bufnr == 0 then
    return vim.api.nvim_get_current_buf()
  end
  return bufnr
end

return M
