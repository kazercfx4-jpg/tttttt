-- Extensions pour les archives
local function getFileExtension(filename)
    return filename:match("^.+(%..+)$") or ""
end-- Configure package.path for requiring Prometheus
local function script_path()
	local str = debug.getinfo(2, "S").source:sub(2)
	return str:match("(.*[/%\\])") or "";
end
package.path = script_path() .. "?.lua;" .. package.path;

-- Require Prometheus modules directly
local Prometheus = require("src.prometheus");
local Ast = require("src.prometheus.ast");
local Parser = require("src.prometheus.parser");
local Enums = require("src.prometheus.enums");

-- Extensions pour les archives
local function getFileExtension(filename)
    return filename:match("^.+(%..+)$") or ""
end

-- Fonction pour extraire les archives ZIP
local function extractZip(inputPath, extractPath)
    local success = os.execute(string.format('unzip -q "%s" -d "%s"', inputPath, extractPath))
    return success == 0
end

-- Fonction pour créer une archive ZIP
local function createZip(outputPath, sourceDir)
    local success = os.execute(string.format('cd "%s" && zip -r "%s" .', sourceDir, outputPath))
    return success == 0
end

-- Fonction pour extraire les archives RAR
local function extractRar(inputPath, extractPath)
    local success = os.execute(string.format('unrar x "%s" "%s"', inputPath, extractPath))
    return success == 0
end

-- Fonction pour créer une archive RAR
local function createRar(outputPath, sourceDir)
    local success = os.execute(string.format('cd "%s" && rar a "%s" *', sourceDir, outputPath))
    return success == 0
end

-- Fonction pour lire un fichier
local function readFile(path)
    local file = io.open(path, "r")
    if not file then return nil end
    local content = file:read("*all")
    file:close()
    return content
end

-- Fonction pour écrire un fichier
local function writeFile(path, content)
    local file = io.open(path, "w")
    if not file then return false end
    file:write(content)
    file:close()
    return true
end

-- Fonction pour créer un dossier
local function createDirectory(path)
    os.execute(string.format('mkdir -p "%s"', path))
end

-- Fonction pour supprimer un dossier récursivement
local function removeDirectory(path)
    os.execute(string.format('rm -rf "%s"', path))
end

-- Fonction pour parcourir les fichiers d'un dossier
local function walkDirectory(dir, callback)
    local handle = io.popen(string.format('find "%s" -type f', dir))
    if not handle then return end
    
    for file in handle:lines() do
        callback(file)
    end
    handle:close()
end

-- Fonction pour parser escrow_ignore du fxmanifest.lua
local function parseEscrowIgnore(manifestContent)
    local escrowIgnore = {}
    local escrowMatch = manifestContent:match("escrow_ignore%s*{([^}]*)}")
    
    if escrowMatch then
        for filename in escrowMatch:gmatch('["\']([^"\']+)["\']') do
            escrowIgnore[filename] = true
        end
        -- Support pour les fichiers sans quotes
        for filename in escrowMatch:gmatch('([%w_%.%-]+)') do
            if not filename:match('["{}\',]') then
                escrowIgnore[filename] = true
            end
        end
    end
    
    return escrowIgnore
end

-- Fonction pour ajouter le watermark automatiquement
local function addWatermark(code)
    local watermark = '--[Obfuscated by FSProtect v1.0 | discord.gg/fsprotect]\n'
    -- Vérifier si le watermark n'est pas déjà présent
    if not code:find('FSProtect v1%.0') then
        return watermark .. code
    end
    return code
end

-- Fonction principale pour traiter les archives
local function processArchive(inputPath, outputPath, preset)
    local extension = getFileExtension(inputPath):lower()
    
    if extension ~= ".zip" and extension ~= ".rar" then
        print("Erreur: Format d'archive non supporté. Utilisez .zip ou .rar")
        return false
    end
    
    -- Créer des dossiers temporaires
    local tempExtract = "/tmp/prometheus_extract_" .. os.time()
    local tempOutput = "/tmp/prometheus_output_" .. os.time()
    
    createDirectory(tempExtract)
    createDirectory(tempOutput)
    
    -- Extraire l'archive
    local extractSuccess = false
    if extension == ".zip" then
        extractSuccess = extractZip(inputPath, tempExtract)
    elseif extension == ".rar" then
        extractSuccess = extractRar(inputPath, tempExtract)
    end
    
    if not extractSuccess then
        print("Erreur: Impossible d'extraire l'archive")
        removeDirectory(tempExtract)
        removeDirectory(tempOutput)
        return false
    end
    
    -- Chercher fxmanifest.lua et parser escrow_ignore
    local escrowIgnore = {}
    local manifestPath = nil
    
    walkDirectory(tempExtract, function(file)
        local filename = file:match("([^/]+)$")
        if filename == "fxmanifest.lua" then
            manifestPath = file
            local manifestContent = readFile(file)
            if manifestContent then
                escrowIgnore = parseEscrowIgnore(manifestContent)
                print("Fichiers ignorés trouvés dans fxmanifest.lua:", table.concat(escrowIgnore, ", "))
            end
        end
    end)
    
    -- Obfusquer les fichiers .lua
    local processedFiles = 0
    walkDirectory(tempExtract, function(file)
        local filename = file:match("([^/]+)$")
        local relativePath = file:gsub(tempExtract .. "/", "")
        local outputFile = tempOutput .. "/" .. relativePath
        
        -- Créer les dossiers de destination
        local outputDir = outputFile:match("(.+)/[^/]+$")
        if outputDir then
            createDirectory(outputDir)
        end
        
        if getFileExtension(filename):lower() == ".lua" then
            -- Ne pas obfusquer fxmanifest.lua et les fichiers dans escrow_ignore
            if filename == "fxmanifest.lua" or escrowIgnore[filename] then
                print("Ignoré: " .. filename)
                -- Copier le fichier sans modification
                local content = readFile(file)
                if content then
                    writeFile(outputFile, content)
                end
            else
                print("Obfuscation: " .. filename)
                -- Obfusquer le fichier
                local content = readFile(file)
                if content then
                    local success, obfuscated = pcall(function()
                        -- Utiliser Prometheus pour obfusquer
                        local pipeline = Prometheus.Pipeline:fromConfig(Prometheus.Presets[preset] or Prometheus.Presets.Strong)
                        return pipeline:apply(content, filename)
                    end)
                    
                    if success then
                        -- Ajouter le watermark automatiquement
                        obfuscated = addWatermark(obfuscated)
                        writeFile(outputFile, obfuscated)
                        processedFiles = processedFiles + 1
                    else
                        print("Erreur lors de l'obfuscation de " .. filename .. ": " .. tostring(obfuscated))
                        -- Copier le fichier original en cas d'erreur
                        writeFile(outputFile, content)
                    end
                else
                    print("Erreur: Impossible de lire " .. file)
                end
            end
        else
            -- Copier les autres fichiers sans modification
            local content = readFile(file)
            if content then
                writeFile(outputFile, content)
            end
        end
    end)
    
    -- Créer la nouvelle archive
    local createSuccess = false
    if extension == ".zip" then
        createSuccess = createZip(outputPath, tempOutput)
    elseif extension == ".rar" then
        createSuccess = createRar(outputPath, tempOutput)
    end
    
    -- Nettoyer les dossiers temporaires
    removeDirectory(tempExtract)
    removeDirectory(tempOutput)
    
    if createSuccess then
        print(string.format("Archive traitée avec succès! %d fichiers obfusqués.", processedFiles))
        return true
    else
        print("Erreur: Impossible de créer l'archive de sortie")
        return false
    end
end

-- Parser les arguments de ligne de commande pour les archives
local function parseArgs()
    local inputFile = nil
    local outputFile = nil
    local preset = "Strong"
    local isArchive = false
    
    for i = 1, #arg do
        if arg[i] == "--preset" and arg[i + 1] then
            preset = arg[i + 1]
        elseif arg[i] == "--input" and arg[i + 1] then
            inputFile = arg[i + 1]
            local ext = getFileExtension(inputFile):lower()
            if ext == ".zip" or ext == ".rar" then
                isArchive = true
            end
        elseif arg[i] == "--output" and arg[i + 1] then
            outputFile = arg[i + 1]
        elseif not inputFile and arg[i]:match("%.") then
            inputFile = arg[i]
            local ext = getFileExtension(inputFile):lower()
            if ext == ".zip" or ext == ".rar" then
                isArchive = true
            end
        elseif not outputFile and isArchive and arg[i]:match("%.") then
            outputFile = arg[i]
        end
    end
    
    return inputFile, outputFile, preset, isArchive
end

-- Logique principale
local inputFile, outputFile, preset, isArchive = parseArgs()

if isArchive and inputFile and outputFile then
    -- Traitement des archives
    print("Mode archive détecté")
    print("Fichier d'entrée: " .. inputFile)
    print("Fichier de sortie: " .. outputFile)
    print("Preset: " .. preset)
    
    local success = processArchive(inputFile, outputFile, preset)
    if not success then
        os.exit(1)
    end
else
    -- Traitement normal des fichiers .lua individuels avec watermark automatique
    if inputFile and getFileExtension(inputFile):lower() == ".lua" then
        local content = readFile(inputFile)
        if content then
            local success, obfuscated = pcall(function()
                local pipeline = Prometheus.Pipeline:fromConfig(Prometheus.Presets[preset] or Prometheus.Presets.Strong)
                return pipeline:apply(content, inputFile)
            end)
            
            if success then
                -- Ajouter le watermark automatiquement
                obfuscated = addWatermark(obfuscated)
                
                local outputFileName = outputFile or (inputFile:gsub("%.lua$", "_obfuscated.lua"))
                local writeSuccess = writeFile(outputFileName, obfuscated)
                if writeSuccess then
                    print("Fichier obfusqué: " .. outputFileName)
                else
                    print("Erreur: Impossible d'écrire le fichier de sortie: " .. outputFileName)
                    os.exit(1)
                end
            else
                print("Erreur lors de l'obfuscation: " .. tostring(obfuscated))
                os.exit(1)
            end
        else
            print("Erreur: Impossible de lire le fichier d'entrée: " .. inputFile)
            os.exit(1)
        end
    else
        print("Erreur: Fichier d'entrée non spécifié ou non valide")
        print("Usage: lua prometheus-main.lua <input.lua> [output.lua] [--preset <preset>]")
        print("   ou: lua prometheus-main.lua <input.zip/rar> <output.zip/rar> [--preset <preset>]")
        os.exit(1)
    end
end
