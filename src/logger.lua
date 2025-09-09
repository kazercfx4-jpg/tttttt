-- This Script is Part of the Prometheus Obfuscator by Levno_710
--
-- logger.lua

local logger = {}
local config = require("config");
local colors = require("colors");

logger.LogLevel = {
	Error = 0,
	Warn = 1,
	Log = 2,
	Info = 2,
	Debug = 3,
}

logger.logLevel = logger.LogLevel.Log;

logger.debugCallback = function(...)
	local args = {...}
	local message = ""
	for i, v in ipairs(args) do
		if i > 1 then message = message .. " " end
		message = message .. tostring(v)
	end
	print(colors(config.NameUpper .. ": " .. message, "grey"));
end;

function logger:debug(...)
	if self.logLevel >= self.LogLevel.Debug then
		self.debugCallback(...);
	end
end

logger.logCallback = function(...)
	local args = {...}
	local message = ""
	for i, v in ipairs(args) do
		if i > 1 then message = message .. " " end
		message = message .. tostring(v)
	end
	print(colors(config.NameUpper .. ": ", "magenta") .. message);
end;

function logger:log(...)
	if self.logLevel >= self.LogLevel.Log then
		self.logCallback(...);
	end
end

function logger:info(...)
	if self.logLevel >= self.LogLevel.Log then
		self.logCallback(...);
	end
end

logger.warnCallback = function(...)
	local args = {...}
	local message = ""
	for i, v in ipairs(args) do
		if i > 1 then message = message .. " " end
		message = message .. tostring(v)
	end
	print(colors(config.NameUpper .. ": " .. message, "yellow"));
end;

function logger:warn(...)
	if self.logLevel >= self.LogLevel.Warn then
		self.warnCallback(...);
	end
end

logger.errorCallback = function(...)
	local args = {...}
	local message = ""
	for i, v in ipairs(args) do
		if i > 1 then message = message .. " " end
		local str = tostring(v)
		-- Éviter les chemins de fichiers dans les messages d'erreur
		if str:match("^[/\\].*%.lua$") then
			str = "file: " .. str:match("([^/\\]+)$")
		end
		message = message .. str
	end
	
	-- S'assurer qu'on a un message valide
	if message == "" or message:match("^%s*$") then
		message = "Unknown error occurred"
	end
	
	print(colors(config.NameUpper .. ": " .. message, "red"))
	error(message);
end;

function logger:error(...)
	local argCount = select('#', ...)
	if argCount == 0 then
		self.errorCallback("Unknown error occurred");
	else
		-- Vérifier si le premier argument ressemble à un chemin de fichier
		local firstArg = select(1, ...)
		if type(firstArg) == "string" and firstArg:match("^[/\\].*%.lua$") then
			self.errorCallback("Error processing file: " .. firstArg:match("([^/\\]+)$"));
		else
			self.errorCallback(...);
		end
	end
end

return logger;
