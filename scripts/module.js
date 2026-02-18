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

    async getPackIndex(pack) {
        this._mrIndexCache ??= new Map();
        if (this._mrIndexCache.has(pack.collection)) return this._mrIndexCache.get(pack.collection);
        const idx = await pack.getIndex({ fields: ["name"] });
        this._mrIndexCache.set(pack.collection, idx);
        return idx;
    }

    async getAllNameEntries(documentName) {
        this._mrNameCache ??= {};
        if (this._mrNameCache[documentName]) return this._mrNameCache[documentName];

        const packs = Array.from(game.packs.values()).filter(p => p.documentName === documentName);
        const all = [];

        for (const pack of packs) {
            const idx = await this.getPackIndex(pack);
            for (const e of idx) {
                const name = e.name ?? "";
                all.push({
                    packCollection: pack.collection,
                    packTitle: pack.title,
                    id: e._id,
                    name,
                    nameLower: name.toLowerCase()
                });
            }
        }

        this._mrNameCache[documentName] = all;
        return all;
    }

    async getDocHaystack(pack, id) {
        this._mrDocTextCache ??= new Map();
        const key = `${pack.collection}:${id}`;
        if (this._mrDocTextCache.has(key)) return this._mrDocTextCache.get(key);

        const doc = await pack.getDocument(id);
        let hay = "";
        if (doc) {
            try {
                hay = JSON.stringify(doc.toObject()) ?? "";
            } catch (e) {
                hay = `${doc.name ?? ""}`;
            }
        }
        hay = hay.toLowerCase();
        if (hay.length > 90000) hay = hay.slice(0, 90000);
        this._mrDocTextCache.set(key, hay);
        return hay;
    }

    scoreName(name, q) {
        const n = (name ?? "").trim().toLowerCase();
        if (!n) return 999;
        if (n === q) return 0;
        if (n.startsWith(q)) return 1;
        if (n.includes(q)) return 2;
        return 10;
    }

    async searchCompendiumContent(documentName, query, limit = 10) {
        const q = (query ?? "").trim().toLowerCase();
        if (!q) return [];

        this._mrLast ??= {};
        const last = this._mrLast[documentName] ?? { q: "", candidates: null };

        const all = await this.getAllNameEntries(documentName);
        let base = all;

        if (last.candidates && q.startsWith(last.q)) {
            base = last.candidates;
        }

        const candidates = [];
        const seenNames = new Set();

        for (const e of base) {
            if (!e.nameLower.includes(q)) continue;
            const key = (e.nameLower || "").trim();
            if (!key) continue;
            if (seenNames.has(key)) continue;
            seenNames.add(key);
            candidates.push(e);
        }

        this._mrLast[documentName] = { q, candidates };

        candidates.sort((a, b) => (this.scoreName(a.name, q) - this.scoreName(b.name, q)) || a.name.localeCompare(b.name));

        const quick = candidates.slice(0, limit).map(c => ({
            packCollection: c.packCollection,
            packTitle: c.packTitle,
            id: c.id,
            name: c.name
        }));

        if (quick.length) return quick;
        if (q.length < limit) return quick;

        const packs = Array.from(game.packs.values()).filter(p => p.documentName === documentName);
        const results = [];
        const maxChecks = 120;
        let checked = 0;

        for (const pack of packs) {
            const idx = await this.getPackIndex(pack);
            for (const e of idx) {
                const hay = await this.getDocHaystack(pack, e._id);
                checked += 1;
                if (hay.includes(q)) {
                    results.push({
                        packCollection: pack.collection,
                        packTitle: pack.title,
                        id: e._id,
                        name: e.name ?? ""
                    });
                }
                if (results.length >= limit) return results;
                if (checked >= maxChecks) return results;
                if ((checked % 8) === 0) await new Promise(r => setTimeout(r, 0));
            }
        }

        return results;
    }

    async importAndMakeLinkFromEntity(entity, isActor, itemFolder, monsterFolder, modulePath) {
        const placeholder = `@@TMP_${foundry.utils.randomID()}@@`;
        const match = [placeholder];
        const processed = placeholder;
        const text = entity?.name ?? "";

        return await this.createJournalItem(
            match,
            text,
            isActor ? null : entity,
            null,
            isActor ? entity : null,
            processed,
            itemFolder,
            monsterFolder,
            modulePath
        );
    }

    async resolveMissingReferences(entries, missingRefs, itemFolder, monsterFolder, modulePath) {
        if (!missingRefs.length) return entries;

        const choices = await this.openMissingLinkResolver(missingRefs);
        const replacementMap = {};

        for (const m of missingRefs) {
            const choice = choices?.[m.placeholder] ?? null;
            const type = choice?.type || m.defaultType || "Item";
            const isActor = type === "Actor";

            let replacement = m.linkText;

            if (choice?.collection && choice?.id) {
                const pack = game.packs.get(choice.collection);
                const doc = pack ? await pack.getDocument(choice.id) : null;
                if (doc) replacement = await this.importAndMakeLinkFromEntity(doc, isActor, itemFolder, monsterFolder, modulePath);
            }

            replacementMap[m.placeholder] = replacement;
        }

        for (const [k, v] of Object.entries(entries)) {
            let content = v;
            for (const m of missingRefs) {
                const rep = replacementMap[m.placeholder] ?? m.linkText;
                content = content.split(m.placeholder).join(rep);
            }
            entries[k] = content;
        }

        return entries;
    }

    async openMissingLinkResolver(missingRefs) {
        const escapeHtml = (s) =>
            String(s)
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#039;");

        const buildContextHtml = (contextLine, linkText) => {
            const ctx = String(contextLine ?? "");
            const lt = String(linkText ?? "");
            if (!ctx) return `<strong>${escapeHtml(lt)}</strong>`;

            const ctxLower = ctx.toLowerCase();
            const ltLower = lt.toLowerCase();
            const idx = lt ? ctxLower.indexOf(ltLower) : -1;

            if (idx < 0) return escapeHtml(ctx);

            const before = ctx.slice(0, idx);
            const match = ctx.slice(idx, idx + lt.length);
            const after = ctx.slice(idx + lt.length);

            return `${escapeHtml(before)}<strong>${escapeHtml(match)}</strong>${escapeHtml(after)}`;
        };

        const rows = missingRefs.map(m => {
            const ph = escapeHtml(m.placeholder);
            const contextHtml = buildContextHtml(m.contextLine, m.linkText);
            const isActor = (m.defaultType || "Item") === "Actor";

            return `
            <tr data-placeholder="${ph}">
                <td class="mr-text" style="width: 42%; vertical-align: top; padding: 10px; border-bottom: 1px solid #e6e6e6; font-weight: 400; color: #000000; background: #ffffff; cursor: pointer;">
                    <div class="mr-context" style="padding: 10px; border: 1px solid #d9d9d9; border-radius: 6px; background: #ffffff; color: #000000; white-space: pre-wrap; word-break: break-word;">${contextHtml}</div>
                </td>
                <td style="width: 12%; vertical-align: top; padding: 10px; border-bottom: 1px solid #e6e6e6; font-weight: 400; color: #000000; background: #ffffff;">
                    <select class="mr-type" style="width: 100%; font-weight: 400; color: #000000;">
                        <option value="Item" ${isActor ? "" : "selected"}>Item</option>
                        <option value="Actor" ${isActor ? "selected" : ""}>Actor</option>
                    </select>
                </td>
                <td style="width: 46%; vertical-align: top; padding: 10px; border-bottom: 1px solid #e6e6e6; font-weight: 400; color: #000000; background: #ffffff;">
                    <input class="mr-query" type="text" style="width: 100%; font-weight: 400; color: #000000;" value="" autocomplete="off" />
                    <input class="mr-picked" type="hidden" value="" />
                </td>
            </tr>
        `;
        }).join("");

        const content = `
        <div style="display: flex; flex-direction: column; gap: 10px;">
            <div class="mr-scroll" style="height: 82vh; overflow: auto; border: 1px solid #cfcfcf; border-radius: 8px; background: #ffffff;">
                <table style="width: 100%; border-collapse: collapse; font-weight: 400; color: #000000; background: #ffffff; border: none!important;">
                    <thead style="border: none!important;">
                        <tr>
                            <th style="text-align: left; padding: 10px; border-bottom: 1px solid #d9d9d9; position: sticky; top: 0; background: #ffffff; z-index: 2; font-weight: 400; color: #000000; text-shadow: none">Text</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 1px solid #d9d9d9; position: sticky; top: 0; background: #ffffff; z-index: 2; font-weight: 400; color: #000000; text-shadow: none">Type</th>
                            <th style="text-align: left; padding: 10px; border-bottom: 1px solid #d9d9d9; position: sticky; top: 0; background: #ffffff; z-index: 2; font-weight: 400; color: #000000; text-shadow: none">Search</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;

        const makeDropdown = () => {
            const dd = document.createElement("div");
            dd.className = "mr-dd-global";
            dd.style.position = "fixed";
            dd.style.display = "none";
            dd.style.background = "#ffffff";
            dd.style.border = "1px solid #cfcfcf";
            dd.style.borderRadius = "6px";
            dd.style.zIndex = "999999";
            dd.style.maxHeight = "180px";
            dd.style.overflow = "auto";
            dd.style.boxShadow = "0 4px 18px rgba(0,0,0,0.15)";
            dd.style.color = "#000000";
            document.body.appendChild(dd);
            return dd;
        };

        const positionDropdown = (dd, input) => {
            const r = input.getBoundingClientRect();
            dd.style.left = `${Math.round(r.left)}px`;
            dd.style.top = `${Math.round(r.bottom + 4)}px`;
            dd.style.width = `${Math.round(r.width)}px`;
        };

        const hideDropdown = (dd) => {
            dd.style.display = "none";
            dd.innerHTML = "";
            dd._anchor = null;
        };

        const showDropdown = (dd) => {
            dd.style.display = "block";
        };

        const renderDropdown = (dd, hits) => {
            if (!hits.length) {
                dd.innerHTML = `<div style="padding: 8px 10px; color: #666666; font-weight: 400;">No matches</div>`;
                return;
            }

            dd.innerHTML = hits.map(h => {
                const val = `${h.packCollection}|${h.id}`;
                const label = `${h.name} (${h.packTitle})`;
                return `<div class="mr-opt" data-val="${escapeHtml(val)}" data-name="${escapeHtml(h.name)}" style="padding: 8px 10px; cursor: pointer; font-weight: 400; color: #000000; background: #ffffff;">${escapeHtml(label)}</div>`;
            }).join("");
        };

        return await new Promise((resolve) => {
            let dd;

            const cleanup = () => {
                if (dd && dd.parentElement) dd.parentElement.removeChild(dd);
                dd = null;
            };

            new Dialog(
                {
                    title: "Resolve missing references",
                    content,
                    render: (html) => {
                        dd = makeDropdown();

                        const root = html[0];
                        const tbody = root.querySelector("tbody");
                        const scrollEl = root.querySelector(".mr-scroll");

                        const debounceMap = new WeakMap();

                        const schedulePopulate = (tr) => {
                            const existing = debounceMap.get(tr);
                            if (existing) window.clearTimeout(existing);
                            const t = window.setTimeout(() => populateRow(tr), 170);
                            debounceMap.set(tr, t);
                        };

                        const populateRow = async (tr) => {
                            const type = tr.querySelector(".mr-type").value;
                            const input = tr.querySelector(".mr-query");
                            const picked = tr.querySelector(".mr-picked");
                            const q = (input.value ?? "").trim();

                            picked.value = "";

                            if (!q) {
                                hideDropdown(dd);
                                return;
                            }

                            dd._anchor = { tr, input };
                            positionDropdown(dd, input);
                            renderDropdown(dd, []);
                            showDropdown(dd);

                            const hits = await this.searchCompendiumContent(type, q, 10);
                            if (!dd._anchor || dd._anchor.tr !== tr) return;

                            positionDropdown(dd, input);
                            renderDropdown(dd, hits);
                            showDropdown(dd);
                        };

                        const applyPick = (tr, val, name) => {
                            const input = tr.querySelector(".mr-query");
                            const picked = tr.querySelector(".mr-picked");
                            input.value = name || "";
                            picked.value = val || "";
                            hideDropdown(dd);
                        };

                        tbody.addEventListener("input", (ev) => {
                            const tr = ev.target.closest("tr");
                            if (!tr) return;
                            if (ev.target.classList.contains("mr-query")) schedulePopulate(tr);
                        });

                        tbody.addEventListener("focusin", (ev) => {
                            const tr = ev.target.closest("tr");
                            if (!tr) return;
                            if (ev.target.classList.contains("mr-query")) schedulePopulate(tr);
                        });

                        tbody.addEventListener("change", (ev) => {
                            const tr = ev.target.closest("tr");
                            if (!tr) return;

                            if (ev.target.classList.contains("mr-type")) {
                                const input = tr.querySelector(".mr-query");
                                const picked = tr.querySelector(".mr-picked");
                                input.value = "";
                                picked.value = "";
                                hideDropdown(dd);
                            }
                        });

                        tbody.addEventListener("click", (ev) => {
                            const tr = ev.target.closest("tr");
                            if (!tr) return;

                            if (ev.target.closest(".mr-text")) {
                                const ph = tr.dataset.placeholder;
                                const m = missingRefs.find(x => x.placeholder === ph) ?? null;
                                const htmlCtx = buildContextHtml(m?.contextLine ?? "", m?.linkText ?? "");
                                new Dialog(
                                    {
                                        title: "Context",
                                        content: `<div style="padding: 6px 0; color: #000000;"><div style="white-space: pre-wrap; word-break: break-word; margin: 0; padding: 10px; border: 1px solid #d9d9d9; border-radius: 6px; background: #ffffff; color: #000000;">${htmlCtx}</div></div>`,
                                        buttons: { ok: { label: "OK" } },
                                        default: "ok"
                                    },
                                    { width: 1200, height: 450, resizable: true }
                                ).render(true);
                                return;
                            }
                        });

                        dd.addEventListener("mousemove", (ev) => {
                            const opt = ev.target.closest(".mr-opt");
                            if (!opt) return;
                            for (const child of dd.children) child.style.background = "#ffffff";
                            opt.style.background = "#f2f2f2";
                        });

                        dd.addEventListener("mousedown", (ev) => {
                            const opt = ev.target.closest(".mr-opt");
                            if (!opt) return;
                            const anchor = dd._anchor;
                            if (!anchor?.tr) return;
                            applyPick(anchor.tr, opt.dataset.val || "", opt.dataset.name || "");
                        });

                        const repositionIfOpen = () => {
                            if (!dd._anchor?.input) return;
                            positionDropdown(dd, dd._anchor.input);
                        };

                        scrollEl?.addEventListener("scroll", () => {
                            if (dd.style.display === "none") return;
                            repositionIfOpen();
                        });

                        window.addEventListener("scroll", repositionIfOpen, true);

                        root.addEventListener("mousedown", (ev) => {
                            const inDialog = root.contains(ev.target);
                            const inDd = dd.contains(ev.target);
                            if (!inDialog || inDd) return;

                            const inInput = ev.target.closest(".mr-query");
                            if (inInput) return;

                            hideDropdown(dd);
                        });

                        root._mrCleanup = () => {
                            window.removeEventListener("scroll", repositionIfOpen, true);
                        };
                    },
                    buttons: {
                        apply: {
                            label: "Apply",
                            callback: (html) => {
                                const root = html[0];
                                const trs = Array.from(root.querySelectorAll("tbody tr"));
                                const out = {};

                                for (const tr of trs) {
                                    const placeholder = tr.dataset.placeholder;
                                    const type = tr.querySelector(".mr-type").value;
                                    const picked = tr.querySelector(".mr-picked").value || "";

                                    if (picked) {
                                        const [collection, id] = picked.split("|");
                                        out[placeholder] = { type, collection, id };
                                    } else {
                                        out[placeholder] = { type, collection: null, id: null };
                                    }
                                }

                                resolve(out);
                            }
                        }
                    },
                    default: "apply",
                    close: (html) => {
                        try {
                            const root = html?.[0];
                            if (root?._mrCleanup) root._mrCleanup();
                        } catch (e) {}
                        cleanup();
                        resolve(null);
                    }
                },
                { width: 2100, height: 1200, resizable: true }
            ).render(true);
        });
    }


    async createJournalItem(match, text, item, spell, monster, processedLine, itemFolder, monsterFolder, modulePath, originalText, missingRefs, defaultType, contextLine) {
		const entity = item || spell || monster;
		if (entity) {
			if (item || spell) {
				let entityType = entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
				let subfolder = await game.folders.find(f => f.name === entityType && f.type === "Item" && f.folder?.id === itemFolder.id);
				if (!subfolder) subfolder = await Folder.create({ name: entityType, type: "Item", folder: itemFolder.id });
				let entityData = entity.toObject();
				entityData.folder = subfolder.id;
				let importedEntity;
				let existing = subfolder.contents.find(f => f.name === text);
				if (!existing) {
					importedEntity = await Item.create(entityData);
				} else {
					importedEntity = existing;
				}

				processedLine = processedLine.replace(match[0], ` @UUID[Item.${importedEntity.id}]{${text}} `);
			} else if (monster) {
				let monsterData = monster.toObject();
				monsterData.folder = monsterFolder.id;
				let importedMonster;
				let existing = monsterFolder.contents.find(f => f.name === text);
				if (!existing) {
					importedMonster = await Actor.create(monsterData);
					if (modulePath) await this.createToken(importedMonster, text, modulePath);
				} else {
					importedMonster = existing;
				}

				processedLine = processedLine.replace(match[0], ` @UUID[Actor.${importedMonster.id}]{${text}} `);
			}
		} else if (missingRefs) {
			const placeholder = `@@MISSING_${foundry.utils.randomID()}@@`;
			missingRefs.push({
				placeholder,
				linkText: (originalText ?? text) ?? "",
				searchText: text ?? "",
				defaultType: defaultType || "Item",
				contextLine: contextLine ?? ""
			});
			processedLine = processedLine.replace(match[0], ` ${placeholder} `);
		} else {
			processedLine = processedLine.replace(match[0], text);
		}
		return processedLine;
	}

    async processJournalItems(line, monsterFolder, itemFolder, missingRefs) {
        const regex = /\[(.*?)\]\((.*?)\)/g;
        let match;
        let processedLine = line;

        const findByName = async (name) => {
            const [item] = await game.packs.get("dnd5e.items").getDocuments({ name });
            const [spell] = await game.packs.get("dnd5e.spells").getDocuments({ name });
            const [monster] = await game.packs.get("dnd5e.monsters").getDocuments({ name });
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

            const defaultType = monster ? "Actor" : "Item";

            processedLine = await this.createJournalItem(
                match,
                text,
                item,
                spell,
                monster,
                processedLine,
                itemFolder,
                monsterFolder,
                null,
                originalText,
                missingRefs,
                defaultType,
                line
            );
        }

        return processedLine.replace("  ", " ");
    }

    async processJournalItemsPathfinder(line, monsterFolder, itemFolder, modulePath, missingRefs) {
        const regex = /\[(.*?)\]\((.*?)\)/g;
        let match;
        let processedLine = line;

        const findByName = async (name) => {
            const [item] = await game.packs.get("pf2e.equipment-srd").getDocuments({ name });
            const [spell] = await game.packs.get("pf2e.spells-srd").getDocuments({ name });
            let monster;
            if (!item && !spell) monster = await this.findMonsterPathfinder(name);
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

            const defaultType = monster ? "Actor" : "Item";

            processedLine = await this.createJournalItem(
                match,
                text,
                item,
                spell,
                monster,
                processedLine,
                itemFolder,
                monsterFolder,
                modulePath,
                originalText,
                missingRefs,
                defaultType,
                line
            );
        }

        return processedLine.replace("  ", " ");
    }

    async processJournals(journals, folder, monsters, monsterFolder, itemFolder, macro, musicList) {
        journals = journals.join("\n").split("\n");
        const mainJournal = await JournalEntry.create({ name: "Dungeon Design", folder: folder.id });

        const entries = {};
        const missingRefs = [];
        let currentEntryTitle = "GM Background";
        let currentEntryLines = [];

        for (let line of journals) {
            const match = line.match(/^## (A\d{1,2}\. .+)/);
            if (match) {
                if (currentEntryLines.length > 0) entries[currentEntryTitle] = currentEntryLines.join("\n");
                currentEntryTitle = match[1];
                currentEntryLines = [];
                continue;
            }
            if (line.startsWith("## Aftermath")) {
                entries[currentEntryTitle] = currentEntryLines.join("\n");
                currentEntryTitle = "Aftermath";
                currentEntryLines = [];
                continue;
            }
            if (/^[\\{}\[! ]/.test(line)) continue;
            if (line.startsWith("## ")) line = `**${line.slice(3)}**`;

            line = await this.processJournalItems(line, monsterFolder, itemFolder, missingRefs);
            line = await this.processJournalMonsters(line, monsters);

            currentEntryLines.push(line);
        }

        if (currentEntryLines.length > 0) entries[currentEntryTitle] = currentEntryLines.join("\n");

        await this.resolveMissingReferences(entries, missingRefs, itemFolder, monsterFolder, null);

        const converter = new showdown.Converter();
        for (let [name, content] of Object.entries(entries)) {
            content = await this.addMusic(name, content, macro, musicList);
            const contentConverted = converter.makeHtml(content);
            await mainJournal.createEmbeddedDocuments("JournalEntryPage", [{
                name,
                "text.content": contentConverted,
                "text.format": CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML
            }]);
        }
    }

    async processJournalsPathfinder(journals, folder, monsters, monsterFolder, itemFolder, macro, musicList, modulePath) {
        journals = journals.join("\n").split("\n");
        const mainJournal = await JournalEntry.create({ name: "Dungeon Design", folder: folder.id });

        const entries = {};
        const missingRefs = [];
        let currentEntryTitle = "GM Background";
        let currentEntryLines = [];

        for (let line of journals) {
            const match = line.match(/^## (A\d{1,2}\. .+)/);
            if (match) {
                if (currentEntryLines.length > 0) entries[currentEntryTitle] = currentEntryLines.join("\n");
                currentEntryTitle = match[1];
                currentEntryLines = [];
                continue;
            }
            if (line.startsWith("## Aftermath")) {
                entries[currentEntryTitle] = currentEntryLines.join("\n");
                currentEntryTitle = "Aftermath";
                currentEntryLines = [];
                continue;
            }

            if (line.startsWith("{{paragraph ")) line = line.slice(12);
            if (line.startsWith("{{line ")) line = line.slice(7);
            if (line.endsWith("}}")) line = line.slice(0, -2);
            if (line.startsWith("{{")) continue;

            if (line.startsWith("## ")) line = `**${line.slice(3)}**`;

            line = await this.processJournalItemsPathfinder(line, monsterFolder, itemFolder, modulePath, missingRefs);
            line = await this.processJournalMonsters(line, monsters);

            currentEntryLines.push(line);
        }

        if (currentEntryLines.length > 0) entries[currentEntryTitle] = currentEntryLines.join("\n");

        await this.resolveMissingReferences(entries, missingRefs, itemFolder, monsterFolder, modulePath);

        const converter = new showdown.Converter();
        for (let [name, content] of Object.entries(entries)) {
            content = await this.addMusic(name, content, macro, musicList);
            const contentConverted = converter.makeHtml(content);
            await mainJournal.createEmbeddedDocuments("JournalEntryPage", [{
                name,
                "text.content": contentConverted,
                "text.format": CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML
            }]);
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
