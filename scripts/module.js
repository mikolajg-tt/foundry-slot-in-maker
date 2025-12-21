import {sbiParser} from "../../5e-statblock-importer/scripts/sbiParser.js";
import {DDImporter} from "../../foundry-vtt-module-maker/ddimport.js";
import {sbiActor} from "../../5e-statblock-importer/scripts/sbiActor.js";

class SessionForm extends FormApplication {
    constructor(object = {}, options = {}) {
        super(object, options);
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: 'session-form',
            title: 'Slot-in Session',
            template: 'modules/foundry-slot-in-maker/templates/sessionInput.html',
            width: 1024,
            closeOnSubmit: true,
            submitOnClose: false,
        });
    }

    async createFolder(path, folderName, folderType) {
        let directory = path.split('/')[1].split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1));
        let initials = directory.map(word => word.charAt(0).toUpperCase()).join('');
        let actorFolderName = initials + ' ' + folderName;
        let actorFolder = game.folders.find(f => f.name === actorFolderName && f.type === folderType);
        if (actorFolder) {
            actorFolder.delete({deleteSubfolders: true, deleteContents: true})
        }
        actorFolder = await Folder.create({ name: actorFolderName, type: folderType, parent: null });

        return actorFolder;

    }

    async processMacros(folder) {
        let macroName = "Stop All Music";
        let macroData = {
            name: macroName,
            type: "script",
            command: `game.playlists.filter(p => p.playing).forEach(p => p.stopAll());`,
            img: "icons/svg/sound-off.svg",
            folder: folder.id
        };
        return Macro.create(macroData);
    }


    async processMusic(folder, modulePath) {
        const musicFolderPath = `${modulePath}/Music`;
        const musicFolders = await FilePicker.browse("data", musicFolderPath);
        let playlist = game.playlists.contents.find(p => p.name === folder.name);
        let playlistsDict = {};
        for (const subFolder of musicFolders.dirs) {
            const files = await FilePicker.browse("data", subFolder);
            if (files.files.length === 0) continue;
            let folderName = decodeURIComponent(subFolder.split('/').pop());
            folderName = folderName.includes("-") ? folderName.split("-")[0] : folderName;
            playlist = await Playlist.create({ name: folderName, folder: folder?.id || null });
            playlistsDict[folderName] = playlist;
            const songFile = files.files[0];
            const songName = decodeURIComponent(songFile.split('/').pop());
            await playlist.createEmbeddedDocuments("PlaylistSound", [{
                name: songName,
                path: songFile,
                playing: false,
                repeat: true
            }]);
        }
        return playlistsDict;
    }



    async extractPages(textInput) {
        let pages = textInput.split('\\page');
        if (pages.length < 3) {
            return null;
        }
        pages = pages.slice(1, -1);
        let pageBreakdown = {
            monsters: []
        };
        let matchedContent = [];
        let tempPages = [];
        for (let i = 0; i < pages.length; i++) {
            let match = pages[i].match(/{{monster[^\n]*\n([\s\S]*?)}}/);
            if (match) {
                matchedContent.push(match[1]);
            } else {
                tempPages.push(pages[i]);
            }
        }
        pageBreakdown.monsters = matchedContent;
        pageBreakdown.journals = tempPages;

        return pageBreakdown;
    }

    async extractPagesPathfinder(textInput) {
        let pages = textInput.split('{{pagebreak}}');
        if (pages.length < 3) {
            return null;
        }
        pages = pages.slice(1, -1);
        let pageBreakdown = {
            journals: []
        };
        for (let i = 0; i < pages.length; i++) {
            let match = pages[i].match(/{{label Creature \d+}}/);
            if (!match) {
                pageBreakdown.journals.push(pages[i])
            }
        }
        return pageBreakdown;
    }

    async createToken(monsterActor, monsterName, modulePath) {
        const tokenFolderPath = `${modulePath}/Tokens`;
        const tokenFiles = await FilePicker.browse("data", tokenFolderPath);
        for (let file of tokenFiles.files) {
            const tokenName = decodeURIComponent(file.split('/').pop().split('.').shift());
            if (tokenName.toLowerCase() === monsterName.toLowerCase()) {
                const tokenData = {
                    img: file
                };
                await monsterActor.update(tokenData);
                break;
            }
        }
    }

    async processMonsters(monsters, folder, modulePath) {
        const monsterList = [];
        for (let monster of monsters) {
            const lines = monster.split('\n');
            const formattedBlock = [];
            for (let line of lines) {
                line = line.replace(/^:\s*$/g, '').trim();
                line = line.replace(/[*#_]/g, '').trim();
                line = line.replace(/::/g, '').trim();
                line = line.replace(/\|-+.*/g, '').trim();
                line = line.replace(/\|/g, ' ').trim();
                line = line.replace(/(\d)ft/g, '$1 ft').trim();
                line = line.replace(/ {2,}/g, ' ').trim();
                formattedBlock.push(line);
            }
            monster = formattedBlock.join('\n');
            monster = monster.trim().split(/\n/g).filter(str => str.length);
            let monsterName = monster[0];
			monster = monster.join('\n');
            let monsterActor = await sbiParser.parseInput(monster).actor.createActor5e(folder.id);
			monsterActor = monsterActor.actor5e;
            if (monsterActor) {
                await this.createToken(monsterActor, monsterName, modulePath)
                monsterList.push(monsterActor)
            }
        }
        return monsterList
    }

    async processMonstersPathfinder(folder, modulePath) {
        const monsterList = [];
        const monsterFolderPath = `${modulePath}/Monsters`;
        const monsterFiles = await FilePicker.browse("data", monsterFolderPath)
        for (let monsterFile of monsterFiles.files) {
            const monsterData = await (await fetch(monsterFile)).text();

            let monsterActor = await Actor.create({name: 'Monster', type: 'npc'});
            await monsterActor.importFromJSON(monsterData);
            await monsterActor.update({ folder: folder.id });
            const monsterName = monsterActor.name;
            await this.createToken(monsterActor, monsterName, modulePath)
            monsterList.push(monsterActor)
        }
        return monsterList
    }

    async processMaps(folder, modulePath) {
        modulePath += '/Maps/'
        await new DDImporter().importModuleMaps(folder, modulePath)
    }

    async processJournalMonsters(line, monsters) {
        for (const monster of monsters) {
            const name = monster.name;
            const pluralName = name + 's';
            const regex = new RegExp(`\\*\\*(${name}|${pluralName})\\*\\*(\\s*\\(see\\s+${name}\\s+statblock\\s+at\\s+the\\s+end\\))?`, 'gi');
            line = line.replace(regex, (match, p1) => {
                return `@UUID[Actor.${monster.id}]{${p1}}`;
            });
            const seeStatblockRegex = new RegExp(`\\(see\\s+${name}\\s+statblock\\s+at\\s+the\\s+end\\) `, 'gi');
            line = line.replace(seeStatblockRegex, '');
        }
        return line;
    }

    async getSingularForm(text) {
        if (text.endsWith('s')) {
            text = text.slice(0, -1);
        }
        else if (text.includes(' ')) {
            text = text.split(' ')
            let tempText = [];
            for (let word of text) {
                if (word.endsWith('s')) {
                    word = word.slice(0, -1);
                }
                tempText.push(word);
            }
            text = tempText.join(' ')
        }


        return text;
    }

    async createJournalItem(match, text, item, spell, monster, processedLine, itemFolder, monsterFolder, modulePath) {
        const entity = item || spell || monster;
        if (entity) {
            if (item || spell) {
                let entityType = entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
                let subfolder = await game.folders.find(f => f.name === entityType && f.type === "Item" && f.folder?.id === itemFolder.id);
                if (!subfolder) {
                    subfolder = await Folder.create({ name: entityType, type: "Item", folder: itemFolder.id });
                }
                let entityData = entity.toObject();
                entityData.folder = subfolder.id;
                let importedEntity;
                if (!game.items.find(f => f.name === text)) {
                    importedEntity = await Item.create(entityData);
                }
                else {
                    importedEntity = game.items.find(f => f.name === text);
                }
                let entityId = importedEntity.id;
                processedLine = processedLine.replace(match[0], ` @UUID[Item.${entityId}]{${text}} `);
            } else if (monster) {
                let monsterData = monster.toObject();
                monsterData.folder = monsterFolder.id;
                let importedMonster;
                if (!game.actors.find(f => f.name === text)) {
                    importedMonster = await Actor.create(monsterData);
                    if (modulePath) {
                        await this.createToken(importedMonster, text, modulePath)
                    }
                }
                else {
                    importedMonster = game.actors.find(f => f.name === text);
                }
                let monsterId = importedMonster.id;
                processedLine = processedLine.replace(match[0], ` @UUID[Actor.${monsterId}]{${text}} `);
            }
        } else {
            processedLine = processedLine.replace(match[0], text);
        }
        return processedLine;
    }

    async processJournalItems(line, monsterFolder, itemFolder) {
        const regex = /\[(.*?)\]\((.*?)\)/g;
        let match;
        let processedLine = line;
        while ((match = regex.exec(line)) !== null) {
            const text = await this.getSingularForm(match[1]);
            const [item] = await game.packs.get("dnd5e.items").getDocuments({ name: text });
            const [spell] = await game.packs.get("dnd5e.spells").getDocuments({ name: text });
            const [monster] = await game.packs.get("dnd5e.monsters").getDocuments({ name: text });
            processedLine = await this.createJournalItem(match, text, item, spell, monster, processedLine, itemFolder, monsterFolder)
        }
        return processedLine.replace('  ', ' ');
    }

    async findMonsterPathfinder(text) {
        let monster = null;
        for (const pack of game.packs.keys()) {
            if (pack.toLowerCase().includes("bestiary")) {
                const documents = await game.packs.get(pack).getDocuments({ name: text });
                if (documents.length > 0) {
                    monster = documents[0];
                    break;
                }
            }
        }
        return monster;
    }

    async processJournalItemsPathfinder(line, monsterFolder, itemFolder, modulePath) {
        const regex = /\[(.*?)\]\((.*?)\)/g;
        let match;
        let processedLine = line;
        const findByName = async (name) => {
            const [item] = await game.packs.get("pf2e.equipment-srd").getDocuments({ name });
            const [spell] = await game.packs.get("pf2e.spells-srd").getDocuments({ name });
            let monster;
            if (!item && !spell) {
                monster = await this.findMonsterPathfinder(name);
            }
            return { item, spell, monster };
        };
        while ((match = regex.exec(line)) !== null) {
            const originalText = match[1];
            let text = originalText;
            let { item, spell, monster } = await findByName(text);
            if (!item && !spell && !monster) {
                const singularText = await this.getSingularForm(originalText);
                const found = await findByName(singularText);

                if (found.item || found.spell || found.monster) {
                    text = singularText;
                    item = found.item;
                    spell = found.spell;
                    monster = found.monster;
                } else {
                    text = originalText;
                    item = undefined;
                    spell = undefined;
                    monster = undefined;
                }
            }
            processedLine = await this.createJournalItem(
                match,
                text,
                item,
                spell,
                monster,
                processedLine,
                itemFolder,
                monsterFolder,
                modulePath
            );
        }

        return processedLine.replace('  ', ' ');
    }

    async addMusic(name, content, macro, musicList) {
        const prefix = name.slice(0, 2);
        if (musicList.hasOwnProperty(prefix)) {
            const music = musicList[prefix];
            let embeddedContent;
            if (prefix === "A1") {
                embeddedContent = `Start playing @UUID[${music.uuid}].\n`;
            }
            else {
                embeddedContent = `@UUID[${macro.uuid}], and start playing @UUID[${music.uuid}].\n`;
            }
            return `${embeddedContent}${content}`;
        }
        return content;
    }

    async processJournals(journals, folder, monsters, monsterFolder, itemFolder, macro, musicList) {
        journals = journals.join('\n').split('\n')
        const mainJournal = await JournalEntry.create({
            name: 'Dungeon Design',
            folder: folder.id
        });
        const entries = {}
        let currentEntryTitle = 'GM Background';
        let currentEntryLines = [];

        for (let line of journals) {
            const match = line.match(/^## (A\d{1,2}\. .+)/);
            if (match) {
                if (currentEntryLines.length > 0) {
                    entries[currentEntryTitle] = currentEntryLines.join('\n');
                }
                currentEntryTitle = match[1];
                currentEntryLines = [];
                continue;
            }
            if (line.startsWith('## Aftermath')) {
                entries[currentEntryTitle] = currentEntryLines.join('\n');
                currentEntryTitle = 'Aftermath'
                currentEntryLines = [];
                continue;
            }
            if (/^[\\{}\[! ]/.test(line)) {
                continue;
            }
            if (line.startsWith('## ')) {
                line = `**${line.slice(3)}**`;
            }
            line = await this.processJournalItems(line, monsterFolder, itemFolder);
            line = await this.processJournalMonsters(line, monsters);

            currentEntryLines.push(line);
        }

        if (currentEntryLines.length > 0) {
            entries[currentEntryTitle] = currentEntryLines.join('\n');
        }

        const converter = new showdown.Converter();
        for (let [name, content] of Object.entries(entries)) {
            content = await this.addMusic(name, content, macro, musicList);
            let contentConverted = converter.makeHtml(content);
            await mainJournal.createEmbeddedDocuments('JournalEntryPage', [{name: name, "text.content": contentConverted, "text.format":CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML}])
        }
    }

    async processJournalsPathfinder(journals, folder, monsters, monsterFolder, itemFolder, macro, musicList, modulePath) {
        journals = journals.join('\n').split('\n')
        const mainJournal = await JournalEntry.create({
            name: 'Dungeon Design',
            folder: folder.id
        });
        const entries = {}
        let currentEntryTitle = 'GM Background';
        let currentEntryLines = [];

        for (let line of journals) {
            const match = line.match(/^## (A\d{1,2}\. .+)/);
            if (match) {
                if (currentEntryLines.length > 0) {
                    entries[currentEntryTitle] = currentEntryLines.join('\n');
                }
                currentEntryTitle = match[1];
                currentEntryLines = [];
                continue;
            }
            if (line.startsWith('## Aftermath')) {
                entries[currentEntryTitle] = currentEntryLines.join('\n');
                currentEntryTitle = 'Aftermath'
                currentEntryLines = [];
                continue;
            }

            if (line.startsWith('{{paragraph ')) {
                line = line.slice(12)
            }

            if (line.startsWith('{{line ')) {
                line = line.slice(7)
            }

            if (line.endsWith('}}')) {
                line = line.slice(0, -2);
            }

            if (line.startsWith('{{')) {
                continue;
            }

            if (line.startsWith('## ')) {
                line = `**${line.slice(3)}**`;
            }
            line = await this.processJournalItemsPathfinder(line, monsterFolder, itemFolder, modulePath);
            line = await this.processJournalMonsters(line, monsters);
            currentEntryLines.push(line);
        }

        if (currentEntryLines.length > 0) {
            entries[currentEntryTitle] = currentEntryLines.join('\n');
        }

        const converter = new showdown.Converter();
        for (let [name, content] of Object.entries(entries)) {
            content = await this.addMusic(name, content, macro, musicList);
            let contentConverted = converter.makeHtml(content);
            await mainJournal.createEmbeddedDocuments('JournalEntryPage', [{name: name, "text.content": contentConverted, "text.format":CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML}])
        }
    }

    async _updateObject(event, formData) {
        if (formData.gameSystem === '') {
            return;
        }

        let pageBreakdown;
        let monsterFolder = await this.createFolder(formData.path, 'Monsters', 'Actor');
        let itemFolder = await this.createFolder(formData.path, 'Items', 'Item');
        let journalFolder = await this.createFolder(formData.path, 'Journals', 'JournalEntry');
        let sceneFolder = await this.createFolder(formData.path, 'Maps', 'Scene');
        let macroFolder = await this.createFolder(formData.path, 'Macros', 'Macro');
        let musicFolder = await this.createFolder(formData.path, 'Music', 'Playlist')
        let monsterList;

        let macro = await this.processMacros(macroFolder);
        let musicList = await this.processMusic(musicFolder, formData.path);

        if (formData.gameSystem === 'Dungeons & Dragons') {
            pageBreakdown = await this.extractPages(formData.moduleText);
            monsterList = await this.processMonsters(pageBreakdown.monsters, monsterFolder, formData.path);
            await this.processJournals(pageBreakdown.journals, journalFolder, monsterList, monsterFolder, itemFolder, macro, musicList);
        }
        else if (formData.gameSystem === 'Pathfinder') {
            pageBreakdown = await this.extractPagesPathfinder(formData.moduleText);
            monsterList = await this.processMonstersPathfinder(monsterFolder, formData.path);
            await this.processJournalsPathfinder(pageBreakdown.journals, journalFolder, monsterList, monsterFolder, itemFolder, macro, musicList, formData.path);
        }

        await this.processMaps(sceneFolder, formData.path);

    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

Hooks.on("renderSceneDirectory", async (app, html) => {
    let footer = $("#scenes .directory-footer.action-buttons");
    if (footer.find("button:contains('Slot-in Session')").length === 0) {
        let sessionButton = $("<button class='import-dd'><i class='fas fa-book'></i>Slot-in Session</button>");
        footer.append(sessionButton);
        sessionButton.on("click", function() {
            new SessionForm().render(true);
        });
    }
});
