-- This Script is Part of the Prometheus Obfuscator by Levno_710
--
-- test.lua
-- This script contains the Code for the Prometheus CLI

-- Configure package.path for requiring Prometheus
local function script_path()
	local str = debug.getinfo(2, "S").source:sub(2)
	return str:match("(.*[/%\\])") or "";
end
package.path = script_path() .. "?.lua;" .. package.path;
---@diagnostic disable-next-line: different-requires
local Prometheus = require("prometheus");
Prometheus.Logger.logLevel = Prometheus.Logger.LogLevel.Info;

-- Check if the file exists
local function file_exists(file)
    local f = io.open(file, "rb")
    if f then f:close() end
    return f ~= nil
end

string.split = function(str, sep)
    local fields = {}
    local pattern = string.format("([^%s]+)", sep)
    str:gsub(pattern, function(c) fields[#fields+1] = c end)
    return fields
end

-- get all lines from a file, returns an empty
-- list/table if the file does not exist
local function lines_from(file)
    if not file_exists(file) then return {} end
    local lines = {}
    for line in io.lines(file) do
      lines[#lines + 1] = line
    end
    return lines
  end

-- CLI
local config;
local sourceFile;
local outFile;
local luaVersion;
local prettyPrint;

Prometheus.colors.enabled = true;

-- Parse Arguments
local i = 1;
while i <= #arg do
    local curr = arg[i];
    if curr:sub(1, 2) == "--" then
        if curr == "--preset" or curr == "--p" then
            if config then
                Prometheus.Logger:warn("The config was set multiple times");
            end

            i = i + 1;
            local preset = Prometheus.Presets[arg[i]];
            if not preset then
                Prometheus.Logger:error(string.format("A Preset with the name \"%s\" was not found!", tostring(arg[i])));
            end

            config = preset;
        elseif curr == "--config" or curr == "--c" then
            i = i + 1;
            local filename = tostring(arg[i]);
            if not file_exists(filename) then
                Prometheus.Logger:error(string.format("The config file \"%s\" was not found!", filename));
            end

            local content = table.concat(lines_from(filename), "\n");
            -- Load Config from File
            local func = loadstring(content);
            -- Sandboxing
            setfenv(func, {});
            config = func();
        elseif curr == "--out" or curr == "--o" then
            i = i + 1;
            if(outFile) then
                Prometheus.Logger:warn("The output file was specified multiple times!");
            end
            outFile = arg[i];
        elseif curr == "--nocolors" then
            Prometheus.colors.enabled = false;
        elseif curr == "--Lua51" then
            luaVersion = "Lua51";
        elseif curr == "--LuaU" then
            luaVersion = "LuaU";
        elseif curr == "--pretty" then
            prettyPrint = true;
        elseif curr == "--saveerrors" then
            -- Override error callback
            Prometheus.Logger.errorCallback = function(...)
                local args = {...};
                local message = ""
                for i, v in ipairs(args) do
                    if i > 1 then message = message .. " " end
                    message = message .. tostring(v)
                end
                
                print(Prometheus.colors(Prometheus.Config.NameUpper .. ": " .. message, "red"))
                
                local fileName = sourceFile and sourceFile:sub(-4) == ".lua" and sourceFile:sub(0, -5) .. ".error.txt" or (sourceFile or "error") .. ".error.txt";
                local handle = io.open(fileName, "w");
                if handle then
                    handle:write(message);
                    handle:close();
                end

                os.exit(1);
            end;
        else
            Prometheus.Logger:warn(string.format("The option \"%s\" is not valid and therefore ignored", curr));
        end
    else
        if sourceFile then
            Prometheus.Logger:error(string.format("Unexpected argument \"%s\"", arg[i]));
        end
        sourceFile = tostring(arg[i]);
    end
    i = i + 1;
end

if not sourceFile then
    Prometheus.Logger:error("No input file was specified!")
end

if not config then
    Prometheus.Logger:warn("No config was specified, falling back to Minify preset");
    config = Prometheus.Presets.Minify;
end

-- Add Option to override Lua Version
config.LuaVersion = luaVersion or config.LuaVersion;
config.PrettyPrint = prettyPrint ~= nil and prettyPrint or config.PrettyPrint;

if not file_exists(sourceFile) then
    Prometheus.Logger:error(string.format("The File \"%s\" was not found!", sourceFile));
end

if not outFile then
    if sourceFile:sub(-4) == ".lua" then
        outFile = sourceFile:sub(0, -5) .. ".obfuscated.lua";
    else
        outFile = sourceFile .. ".obfuscated.lua";
    end
end

-- Read source file safely
local source = "";
local sourceLines = lines_from(sourceFile);
if #sourceLines == 0 then
    Prometheus.Logger:error(string.format("Could not read source file \"%s\" or file is empty!", sourceFile));
end
source = table.concat(sourceLines, "\n");

local pipeline = Prometheus.Pipeline:fromConfig(config);

-- Apply obfuscation with detailed error handling
local success, result = pcall(function()
    return pipeline:apply(source, sourceFile);
end);

if not success then
    local errorMsg = tostring(result) or "Unknown error during obfuscation";
    -- Extract just the error message, not file paths
    if errorMsg:match("%.lua:%d+:") then
        errorMsg = errorMsg:match("%.lua:%d+:%s*(.+)") or errorMsg;
    end
    Prometheus.Logger:error(string.format("Obfuscation failed: %s", errorMsg));
    return;
end

if not result or result == "" then
    Prometheus.Logger:error("Obfuscation produced empty result");
    return;
end

local out = result;
Prometheus.Logger:info(string.format("Writing output to \"%s\"", outFile));

-- Write Output with error checking
local handle, err = io.open(outFile, "w");
if not handle then
    Prometheus.Logger:error(string.format("Could not open output file \"%s\" for writing: %s", outFile, err or "Unknown error"));
    return;
end

local writeSuccess, writeErr = pcall(function()
    handle:write(out);
    handle:close();
end);

if not writeSuccess then
    Prometheus.Logger:error(string.format("Error writing to output file: %s", writeErr or "Unknown write error"));
    return;
end
