import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const FACE = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'face.js'), 'utf8');
const CSS = readFileSync(resolve(import.meta.dirname, '..', 'assets', 'face.css'), 'utf8');

test('Face form factor is route-owned, never inferred from a Fire TV viewport', () => {
  assert.doesNotMatch(FACE, /PHONE_SHORT_SIDE/);
  assert.doesNotMatch(FACE, /setAttribute\(['"]data-size['"],\s*['"]phone['"]\)/);
  assert.match(FACE, /function markOrientation\(\)[\s\S]*root\.removeAttribute\(['"]data-size['"]\)/);
});

test('one physical screen identity owns every face it wears', () => {
  const naming = /function displayName\(\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(naming, /return where/);
  assert.doesNotMatch(naming, /current|data-face/,
    'Canvas, Libretto and the other faces cannot become separate settings entries');
  assert.match(FACE, /localStorage\.getItem\(['"]flightdeck\.display['"]\)/,
    'the stable browser id, not the face, remains the physical display identity');
});

test('header keeps Face | Queue Room Group order and each menu belongs to its own door', () => {
  const headerStart = FACE.indexOf('var homeMark =');
  const headerEnd = FACE.indexOf("var body = el('div', 'body')", headerStart);
  const header = FACE.slice(headerStart, headerEnd);
  assert.match(header,
    /headMark\.appendChild\(homeMark\);\s*headMark\.appendChild\(cog\);/,
    'Face moves beside the return mark over the artwork');
  assert.match(header,
    /headTools\.appendChild\(queueDoor\);\s*headTools\.appendChild\(zoneName\);\s*headTools\.appendChild\(groupDoor\);/,
    'the right-hand grammar remains Queue, current room, Group');
  assert.doesNotMatch(header, /headTools\.appendChild\(cog\)/,
    'Face cannot drift back into the room-action group');
  assert.match(CSS, /data-layout=['"]classic['"]\] \.headmark \{ width: 34vw; \}/,
    'the relocated Face mark occupies Classic artwork width, not the copy rail');
  assert.match(FACE, /pressable\(cog, function \(\) \{ openPanel\(['"]faces['"]\); \}\)/);
  assert.match(FACE, /pressable\(queueDoor, openQueuePanel, ['"]header-queue['"]\)/);
  assert.match(FACE, /function openDisplayPicker\(\) \{ openPanel\(['"]rooms['"]\); \}/);
  assert.match(FACE, /pressable\(zoneName, openDisplayPicker, ['"]header-rooms['"]\)/);
  assert.match(FACE, /pressable\(groupDoor, startGroupPick\)/);

  const anchorsStart = FACE.indexOf('function headerPickerTrigger(mode)');
  const anchorsEnd = FACE.indexOf('function clearHeaderPickerPosition()', anchorsStart);
  const anchors = FACE.slice(anchorsStart, anchorsEnd);
  assert.match(anchors, /mode === ['"]queue['"][^\n]*return queueDoor/);
  assert.match(anchors, /mode === ['"]rooms['"][^\n]*return zoneName/);
  assert.match(anchors, /mode === ['"]group['"][^\n]*return groupDoor/);
  assert.match(anchors, /mode === ['"]faces['"][^\n]*return cog/);
  assert.match(anchors, /trigger\.getBoundingClientRect\(\)/);
  assert.match(anchors, /rect\.bottom \+ 8/,
    'every popout starts immediately below the trigger that opened it');
  assert.match(anchors, /mode === ['"]queue['"]\) left = rect\.left/);
  assert.match(anchors, /mode === ['"]group['"]\) left = rect\.right - width/);
  assert.match(anchors, /rect\.left \+ \(rect\.width \/ 2\) - \(width \/ 2\)/,
    'Face and Room centre on their own variable-width triggers');

  const presentStart = FACE.indexOf('function presentPicker(');
  const presentEnd = FACE.indexOf('function showPicker(', presentStart);
  const present = FACE.slice(presentStart, presentEnd);
  assert.match(present, /headerOwned = trigger !== null && root\.getAttribute\(['"]data-size['"]\) === null/);
  assert.match(present, /host = headerOwned \? document\.body/);
  assert.match(present, /if \(picker\.parentNode !== host\) host\.appendChild\(picker\)/);
  assert.match(present, /headerOwned \? ['"] header-menu['"] : ['"]['"]/);
  assert.match(CSS, /body > #picker\.picker\.header-menu \{[\s\S]{0,100}z-index: 70/,
    'body ownership gives header menus one viewport coordinate system');
});

test('Queue reads a fenced forward window and only future rows can select', () => {
  const optionStart = FACE.indexOf('function queueOption(');
  const optionEnd = FACE.indexOf('function selectQueueItem(', optionStart);
  const option = FACE.slice(optionStart, optionEnd);
  const current = option.indexOf('if (index === 0)');
  const future = option.indexOf('} else {', current);
  const press = option.indexOf('pressable(node', future);
  assert.ok(current >= 0 && future > current && press > future,
    'the current row is information; only a later queue row receives a press action');
  assert.match(option, /index === 0[\s\S]{0,180}role['"], ['"]listitem/);
  assert.match(option, /else \{[\s\S]{0,260}selectQueueItem\(zoneId, item\)/);

  const loadStart = FACE.indexOf('function loadQueue(');
  const loadEnd = FACE.indexOf('function openQueuePanel(', loadStart);
  const load = FACE.slice(loadStart, loadEnd);
  assert.match(load, /fetch\(['"]\/api\/v1\/queue\?zone=['"] \+ encodeURIComponent\(zoneId\), \{ cache: ['"]no-store['"] \}\)/);
  assert.match(load, /if \(!queuePanelIsOpen\(zoneId, epoch\)\) return/,
    'a response from a closed, replaced or different-room Queue cannot repaint');
  assert.match(load, /queueView\.generation = typeof data\.generation/);
  assert.match(load, /queueView\.revision = typeof data\.revision/);

  const selectStart = FACE.indexOf('function selectQueueItem(');
  const selectEnd = FACE.indexOf('function loadQueue(', selectStart);
  const select = FACE.slice(selectStart, selectEnd);
  assert.match(select,
    /zone\.id !== zoneId[\s\S]{0,160}queueView\.generation !== snapshot\.generation[\s\S]{0,160}queueView\.revision < 0/,
    'selection first revalidates the displayed room and the window receipt');
  assert.match(select, /fetch\(['"]\/api\/v1\/queue['"], \{\s*method: ['"]POST['"]/);
  assert.match(select,
    /zone: zoneId,\s*itemId: String\(item\.id \|\| ['"]['"]\),\s*generation: queueView\.generation,\s*queueRevision: queueView\.revision/,
    'the action names the exact zone, item and queue window that the user read');
  assert.doesNotMatch(select, /title:\s*String|revision:\s*snapshot\.revision/,
    'display text and the unrelated zone snapshot revision are not queue authority');
  assert.match(select, /if \(!response\.ok\)[\s\S]*picker\.hidden = true/,
    'the panel closes only after Roon accepts the explicit future-row selection');
});

test('Silk Browse keeps a visible native drag rail without changing other TVs', () => {
  assert.match(FACE, /Silk/);
  assert.match(FACE, /navigator\.userAgent[\s\S]{0,100}setAttribute\(['"]data-silk['"], ['"]1['"]\)/);
  assert.match(CSS, /\.face\[data-silk\] \.browse-list::\-webkit-scrollbar \{ width: 16px; \}/);
  assert.match(CSS, /\.face\[data-silk\] \.browse-list::\-webkit-scrollbar-track[\s\S]{0,120}border-radius: 8px/);
  assert.match(CSS, /\.face\[data-silk\] \.browse-list::\-webkit-scrollbar-thumb[\s\S]{0,180}min-height: 48px[\s\S]{0,180}background-clip: padding-box/);
});

test('room name chooses the displayed player while only the group badge opens the group editor', () => {
  assert.match(FACE, /zoneName\.setAttribute\(['"]aria-label['"], ['"]choose a room to display['"]\)/);
  assert.match(FACE, /pressable\(zoneName, openDisplayPicker, ['"]header-rooms['"]\)/);
  assert.match(FACE, /pressable\(groupDoor, startGroupPick\)/);
  assert.match(FACE, /inNode\(target, zoneName\)[\s\S]{0,80}openPanel\(['"]rooms['"]\); return/);
  assert.doesNotMatch(FACE, /pressable\(zoneName, startGroupPick\)/);
  assert.doesNotMatch(FACE, /inNode\(target, zoneName\)[\s\S]{0,80}startGroupPick\(\)/);
});

test('face picker has a direct control and D-pad face changes expose the choices', () => {
  assert.match(FACE, /pressable\(cog, function \(\) \{ openPanel\(['"]faces['"]\); \}\)/);
  assert.match(FACE, /event\.type === ['"]keyup['"][\s\S]*keyCode !== 13 && keyCode !== 32/);
  assert.match(FACE, /name === ['"]left['"][\s\S]*cycleFace\(-1\)[\s\S]*showPicker\(['"]faces['"]\)/);
  assert.match(FACE, /name === ['"]right['"][\s\S]*cycleFace\(1\)[\s\S]*showPicker\(['"]faces['"]\)/);
});

test('an open vertical face picker keeps its presentation and press identity across redraw', () => {
  assert.match(FACE, /mode === ['"]faces['"] \? ['"] face-picker-vertical['"] : ['"]['"]/,
    'every face opening receives the same presentation class');
  const show = /function showPicker\(mode, refreshing\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.doesNotMatch(show, /hasFlank\(\)|hasColumn\(\)/,
    'the open selector geometry cannot be re-decided by the face being previewed');
  assert.match(CSS,
    /#picker\.picker\.mode-faces\.face-picker-vertical \{[\s\S]{0,220}position: fixed[\s\S]{0,180}right: 5vw[\s\S]{0,180}width: 21vw/,
    'ID ownership outranks every live data-flank/data-column rail selector');
  assert.match(CSS,
    /\.picker\.mode-faces \.row-faces span\.opt \{[\s\S]{0,120}width: 100%/);
  assert.match(FACE, /pressable\(node,[\s\S]{0,100}applyFace\(name\)[\s\S]{0,60}['"]face:['"] \+ name\)/,
    'replacement nodes share one semantic pointer-echo gate');
  const apply = /function applyFace\(name\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(apply,
    /querySelectorAll\(['"]\[data-face-option\]['"]\)[\s\S]{0,260}setPickerNavigation\(faceChoices\[fc\]\)/,
    'pointer and dwell selections align the remote focus mark before rebuilding');
  const refresh = /function refreshPicker\(\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(refresh, /showPicker\([^\n]+, true\)/,
    'a repaint preserves navigation, geometry and the original close deadline');
  const cycle = /function cycleFace\(delta\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(cycle, /applyFace\(/);
  assert.doesNotMatch(cycle, /refreshPicker\(/, 'applyFace already owns the single redraw');
});

test('each face remembers its own cover transition and the picker keeps remote focus aligned', () => {
  assert.match(FACE,
    /var STORE_KEY_TRANSITION = ['"]flightdeck\.cover-transition\.['"];/);
  assert.match(FACE,
    /var TRANSITIONS = \[['"]random['"], ['"]flip['"], ['"]slide['"], ['"]dissolve['"], ['"]lift['"], ['"]none['"]\];/,
    'the visible order begins with the safe default and ends with an explicit off choice');
  assert.match(FACE,
    /localStorage\.getItem\(STORE_KEY_TRANSITION \+ face\)/,
    'the physical browser remembers one choice for each face, independent of room');
  assert.match(FACE,
    /function transitionForFace\(face\)[\s\S]{0,180}TRANSITIONS\.indexOf\(stored\) === -1 \? ['"]random['"] : stored/,
    'missing or stale preferences fall back to Tasteful Random');

  const applyFaceStart = FACE.indexOf('function applyFace(name)');
  const applyFaceEnd = FACE.indexOf('function faceOption(name)', applyFaceStart);
  const applyFace = FACE.slice(applyFaceStart, applyFaceEnd);
  assert.match(applyFace,
    /current = name;[\s\S]{0,100}transitionMode = transitionForFace\(current\)[\s\S]{0,140}data-cover-transition/,
    'changing face restores that face\'s transition before repainting');
  assert.ok(applyFace.indexOf("if (name === current) return") > applyFace.indexOf('setPickerNavigation(faceChoices[fc])'),
    'pressing the already-current face still aligns the D-pad cursor');

  const applyTransitionStart = FACE.indexOf('function applyTransition(name)');
  const applyTransitionEnd = FACE.indexOf('function transitionOption(name)', applyTransitionStart);
  const applyTransition = FACE.slice(applyTransitionStart, applyTransitionEnd);
  assert.match(applyTransition,
    /var wanted = ['"]transition:['"] \+ current \+ ['"]:['"] \+ name[\s\S]{0,260}setPickerNavigation\(transitionChoices\[tc\]\)/,
    'pointer and remote share a face-qualified semantic choice');
  assert.ok(applyTransition.indexOf('if (name === transitionMode) return')
      > applyTransition.indexOf('setPickerNavigation(transitionChoices[tc])'),
    'pressing the active effect still moves the D-pad cursor before returning');
  assert.match(FACE,
    /node\.setAttribute\(['"]data-picker-key['"], key\)[\s\S]{0,100}pressable\(node,[\s\S]{0,80}, key\)/,
    'a structural repaint retains the same face-and-effect press identity');
  assert.match(FACE,
    /var names = \[['"]data-picker-key['"],/,
    'picker navigation prefers the stable qualified identity');
  assert.match(FACE, /name === ['"]random['"] \? ['"]tasteful random['"] : name/);
});

test('a grouped zone remains a normal player choice and double click remains an optional ungroup shortcut', () => {
  assert.doesNotMatch(FACE, /isCurrentGroup|lockedIsGroup/);
  assert.match(FACE, /if \(lockedOutputId !== null\)[\s\S]{0,260}roomOption\(here, ['"]now is-playing['"], null\)/);
  assert.match(FACE, /var opt = roomOption\(z,[\s\S]{0,900}shownZoneId = z\.id;[\s\S]{0,260}boundOutputId = z\.outputs\.length > 0 \? z\.outputs\[0\]\.id : null/);
  assert.match(FACE, /function bindGroupDoubleClick[\s\S]{0,220}addEventListener\(['"]dblclick['"][\s\S]{0,220}ungroupWhole/);
  assert.match(FACE, /bindGroupDoubleClick\(opt, z\.id\)/);
});

test('the room-name chooser is a complete vertical list, not a clipped card runway', () => {
  assert.match(FACE, /var roomRow = el\(['"]div['"], ['"]row row-faces row-column['"]\)/);
  assert.match(FACE, /for \(var r = 0; r < zones\.length; r \+= 1\)[\s\S]{0,100}zones\[r\]\.outputs\.length === 0\) continue/,
    'only empty snapshot husks are omitted');
  assert.match(CSS, /\.picker \.row-column \{[\s\S]{0,640}overflow-y: auto/,
    'later rooms remain reachable by scrolling');
});

test('opening the group editor cannot silently switch the displayed player', () => {
  const start = /function startGroupPick\(\) \{([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(start, /showPicker\(['"]group['"]\)/);
  assert.doesNotMatch(start, /shownZoneId|boundOutputId|following|render\(|command\(/);
});

test('group editor selects first, then exposes explicit horizontal Group, Ungroup and Transfer To verbs', () => {
  assert.match(FACE, /nodes\.push\(groupEditorActionRow\(\)\)/);
  assert.match(CSS, /\.picker \{[\s\S]{0,260}flex-direction: column[\s\S]{0,180}flex-wrap: nowrap/,
    'the outer column must not wrap the final action row outside the panel');
  assert.match(CSS, /\.picker\.mode-group > \.group-actions[\s\S]{0,220}flex: 0 0 auto/);
  assert.doesNotMatch(CSS, /data-flank\] \.picker\.mode-group > \.group-actions[\s\S]{0,180}flex-direction: column/,
    'short icon labels stay on one row even on flank faces');
  assert.match(CSS, /max-width: 1400px[\s\S]{0,80}orientation: landscape[\s\S]{0,220}face:not\(\[data-size\]\) \.copy > \.picker\.mode-group[\s\S]{0,180}position: fixed/,
    'every low-CSS-width Fire TV face gets a full safe-area group editor');
  assert.match(CSS, /face:not\(\[data-size\]\) \.copy > \.picker\.mode-group,\s*\.face:not\(\[data-size\]\)\[data-flank\] \.copy > \.picker\.mode-group[\s\S]{0,180}width: auto/,
    'the late safe-area rule must match flank specificity so its width wins the cascade');
  assert.match(CSS, /\.picker > \.row \{ margin-left: 0; margin-right: 0; \}/,
    'full-width picker rows must not create a horizontal scrollbar');
  assert.match(FACE, /pickerAction\(['"]group['"], ['"]edit['"][\s\S]{0,100}startGroupPick/);
  assert.match(FACE, /pickerAction\(['"]ungroup['"], ['"]ungroup['"][\s\S]{0,160}ungroupWhole/);
  assert.match(FACE, /pickerAction\(['"]transfer-to['"], ['"]transfer to['"][\s\S]{0,180}startTransferFrom/);
  assert.match(FACE, /pickerAction\(['"]pull-from['"], ['"]pull from['"][\s\S]{0,180}startPullInto/);
  assert.match(FACE, /pickerAction\(['"]group['"], ['"]group['"][\s\S]{0,120}commitGroupPick/);
  assert.match(FACE, /pickerAction\(['"]ungroup['"], ['"]ungroup['"][\s\S]{0,120}ungroupGroupPick/);
  assert.match(FACE, /pickerAction\(['"]transfer-to['"], ['"]transfer to['"][\s\S]{0,160}transferGroupPick/);
  assert.doesNotMatch(FACE, /GROUP_SETTLE_MS|groupSettleTimer|armGroupSettle|cancelGroupSettle|this group is as it is/);
  assert.doesNotMatch(CSS, /\.opt\.settling|@keyframes settle/);
});

test('semantic press gate survives a shelf repaint so shuffle cannot bounce back on', () => {
  assert.match(FACE, /shelfTransport\.replaceChildren\(buildControls\(zone, false\)\)/,
    'the test pins the replacement-node condition that exposed the bug');
  assert.match(FACE, /var pressEchoAt = \{\}/);
  assert.match(FACE, /var PRESS_ECHO_MS = 800/);
  assert.match(FACE, /function pressable\(node, onPress, pressKey\)/);
  assert.match(FACE, /pressEchoAt\[pressKey\][\s\S]{0,220}now - previous < PRESS_ECHO_MS/);
  assert.match(FACE, /['"]shuffle:['"] \+ zoneKey/);
});

test('room drag is an add-only grouping gesture whose drop target remains the leader', () => {
  assert.match(FACE, /source\.outputs\.length === 1/);
  assert.match(FACE, /roomZoneIsland\(source\) === roomZoneIsland\(target\)/);
  assert.match(FACE, /boundOutputId = target\.outputs\[0\]\.id/);
  assert.match(FACE, /var ids = target\.outputs\.map[\s\S]{0,260}command\(\{ action: ['"]group['"], outputs: ids \}\)/,
    'a completed drop commits once instead of relying on an auto-settle timer');
  assert.match(FACE, /Date\.now\(\) < roomDragSuppressUntil/);
});

test('group selection itself is inert and Group flattens selected zones leader-first', () => {
  assert.match(FACE, /function toggleGroupPick\(zoneId\)[\s\S]{0,520}paintGroupPick\(\)/);
  const toggle = /function toggleGroupPick\(zoneId\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.doesNotMatch(toggle, /command\(/, 'selecting a card must not touch Roon');
  assert.match(FACE, /function commitGroupPick\(\)[\s\S]{0,620}zones\[i\]\.outputs[\s\S]{0,320}command\(\{ action: ['"]group['"], outputs: ids \}\)/);
  assert.match(FACE, /function ungroupGroupPick\(\)[\s\S]{0,180}zones\.length === 1[\s\S]{0,120}ungroupWhole/);
  assert.match(FACE, /data-group-zone/);
  assert.match(CSS, /\.group-pick-order/);
  assert.match(FACE, /Every live Roon zone is shown once/);
  assert.match(FACE, /if \(z\.outputs\.length === 0\) return/,
    'only empty snapshot husks are omitted before the user makes a selection');
  assert.doesNotMatch(FACE, /if \(!joinable\) return/,
    'compatible choices are disabled relative to the first selection, not hidden up front');
});

test('an overflowing room column keeps the current playing group reachable at the top', () => {
  assert.match(FACE, /if \(liveHead !== null\) liveOrdered\.push\(liveHead\)/,
    'the display group is deliberately the first card');
  assert.match(FACE, /z\.state === ['"]playing['"] \|\| z\.state === ['"]loading['"] \? ['"] is-playing['"] : ['"]/,
    'the active group is visibly distinct as well as first');
  assert.match(CSS,
    /\.picker \.row-column \{[\s\S]{0,620}justify-content: flex-start[\s\S]{0,100}min-height: 0[\s\S]{0,100}overflow-y: auto/,
    'vertical centring creates unreachable negative overflow when many rooms are present');
});

test('grouping instructions live in a pressable edge popover, not in the room list', () => {
  assert.match(FACE, /function roomDragHelp\(message\)[\s\S]{0,1200}pressable\(tab[\s\S]{0,180}pinned = !pinned/);
  assert.match(FACE, /nodes\.push\(roomDragHelp\(GROUP_HELP_TEXT\)\)/);
  assert.doesNotMatch(FACE, /nodes\.push\(el\(['"]div['"], ['"]room-drag-guide['"]/,
    'the lesson must not consume a permanent picker row');
  assert.match(CSS, /\.group-help \{[\s\S]{0,160}position: absolute[\s\S]{0,160}pointer-events: none/);
  assert.match(CSS, /\.picker span\.group-help-tab \{[\s\S]{0,180}position: absolute[\s\S]{0,180}translate\(48%, -48%\)/);
  assert.match(CSS, /\.group-help \.room-drag-guide \{[\s\S]{0,120}top: auto; bottom: 0/,
    'the popup belongs over the inactive action area, never over the first group target');
  assert.match(CSS, /data-shelf\] \.copy > \.picker\.mode-group \{ overflow: visible; \}/,
    'the later shelf rule must not clip the tab that straddles the picker edge');
  assert.match(CSS, /\.picker\.is-room-dragging \.group-help \.room-drag-guide[\s\S]{0,80}visibility: visible/,
    'the same popover becomes live target guidance during a drag');
});

test('structural snapshots refresh live zone editors without extending their deadline', () => {
  assert.match(FACE, /var zone = resolveZone\(snapshot\)[\s\S]{0,120}refreshStructuralPicker\(kind\)/);
  const refresh = /function refreshStructuralPicker\(kind\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  for (const mode of ['group', 'rooms', 'transfer', 'pull']) {
    assert.match(refresh, new RegExp("mode === ['\"]" + mode + "['\"]"));
  }
  assert.match(refresh, /showPicker\(mode, true\)/);
  assert.match(FACE,
    /var linger = \(mode === ['"]group['"][\s\S]{0,160}mode === ['"]pull['"][\s\S]{0,160}22000/,
    'both move pickers retain the long TV interaction deadline');
  assert.match(FACE, /function showPicker\(mode, refreshing\)/);
  assert.match(FACE, /if \(!refreshing\)[\s\S]{0,120}panelShownAt = Date\.now\(\)/,
    'a snapshot repaint must preserve the original interaction and close deadlines');
});

test('Transfer To freezes its source, moves the queue honestly, then follows only a confirmed destination', () => {
  assert.match(FACE,
    /var transferGuide = el\(['"]div['"], ['"]move-guide['"][\s\S]{0,220}current queue[\s\S]{0,180}this display switches to that player/,
    'the picker explains both the playback move and the display switch');
  assert.doesNotMatch(FACE, /queue and position|position move/,
    'the UI must not promise more than Roon documents');
  assert.match(FACE, /roomCardAction\(destination, ['"]transfer-to['"], ['"]transfer here['"]\)/,
    'every destination states what choosing it will do');
  assert.match(FACE,
    /fromZone === null \|\| z\.id === fromZone\.id \|\| z\.outputs\.length === 0/);
  assert.match(FACE, /var transferSourceOutputId = null/);
  assert.match(FACE, /zoneForOutputId\(snap3, transferSourceOutputId\)/);
  const enterTransfer = /function transferGroupPick\(\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(enterTransfer, /startTransferFrom\(zones\[0\]\)/);
  assert.doesNotMatch(enterTransfer, /shownZoneId|boundOutputId|following|command\(/,
    'opening or cancelling Transfer must not switch the displayed player');
  const transferStart = FACE.indexOf("if (mode === 'transfer')");
  const transferEnd = FACE.indexOf("if (mode === 'pull')", transferStart);
  const transfer = FACE.slice(transferStart, transferEnd);
  const requestAt = transfer.indexOf("command({ action: 'transfer'");
  const successAt = transfer.indexOf('if (!ok || lockedOutputId !== null) return', requestAt);
  const bindAt = transfer.indexOf('boundOutputId = destinationOutputId', successAt);
  assert.ok(requestAt >= 0 && successAt > requestAt && bindAt > successAt,
    'the display follows only after the server accepted Transfer');
  assert.match(transfer, /if \(!ok \|\| lockedOutputId !== null\) return/,
    'an administrative lock arriving during Transfer still wins');
  assert.match(transfer,
    /command\(\{\s*action: ['"]transfer['"],\s*zone: fromZone\.id,\s*output: destinationOutputId\s*\}\)/,
    'Transfer names its destination by durable output rather than a disposable zone id');
  assert.doesNotMatch(transfer, /command\(\{[^}]*\bto:/,
    'the legacy destination-zone tuple must not cross the wire');
  assert.match(transfer, /row row-faces row-column/,
    'move targets stay legible as one vertical list');
  assert.match(FACE, /lockedOutputId === null && here\.nowPlaying !== null/,
    'a locked display cannot offer a verb whose contract is to leave that player');
});

test('Pull From keeps the durable destination, lists only active sources and sends one fenced request', () => {
  assert.match(FACE, /pickerAction\(['"]pull-from['"], ['"]pull from['"][\s\S]{0,180}startPullInto/);
  assert.match(FACE, /var pullDestinationOutputId = null/);
  const pullStart = FACE.indexOf("if (mode === 'pull')");
  const pullEnd = FACE.indexOf("if (mode === 'faces')", pullStart);
  const pull = FACE.slice(pullStart, pullEnd);
  assert.match(pull, /row row-faces row-column/);
  assert.match(pull,
    /source\.id === pullZone\.id[\s\S]{0,100}source\.state !== ['"]playing['"][\s\S]{0,100}source\.nowPlaying === null[\s\S]{0,100}source\.outputs\.length === 0/,
    'paused, loading, empty and current zones are not Pull sources');
  assert.match(pull,
    /shownZoneId = pullZone\.id;\s*boundOutputId = pullOutput\.id;\s*following = false;\s*command\(\{\s*action: ['"]pull['"],\s*from: source\.id,\s*output: pullOutput\.id,\s*generation: pullSnapshot\.generation,\s*revision: pullSnapshot\.revision/,
    'the exact source, durable destination and snapshot fence cross the wire');
  assert.doesNotMatch(pull, /action: ['"]play['"]|shownZoneId = source|boundOutputId = source/,
    'the browser neither follows the source nor owns the conditional Play');
  assert.match(FACE, /'transfer-to': \[[\s\S]{0,160}'pull-from': \[/,
    'the two visible arrows are a matched directional pair');
  const roomActions = /function zoneActionRow\(here\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(roomActions, /transfer to[\s\S]{0,120}lockedOutputId === null/);
  assert.match(roomActions, /pull from[\s\S]{0,120}hasPullSource|hasPullSource[\s\S]{0,120}pull from/,
    'Pull remains available to bring music into a locked display');
});

test('command reports success without changing callers that ignore its result', () => {
  const body = /function command\(body\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(body, /if \(!response\.ok\)[\s\S]*return false/);
  assert.match(body, /return true/);
  assert.match(body, /catch\(function \(\)[\s\S]*return false/);
  assert.match(body,
    /if \(groupTransition \|\| body\.action === ['"]transfer['"] \|\| body\.action === ['"]pull['"]\)[\s\S]{0,100}settlingUntil/,
    'all topology-replacing move verbs suppress their own transient missing-zone frame');
  assert.match(body, /if \(groupTransition\)[\s\S]{0,500}var anchor = currentZone\(\)/,
    'only a grouping transition performs the automatic lead-output anchor');
});

test('a no-duration stream clears every finite progress surface before showing LIVE', () => {
  const reset = /function resetProgress\(zone\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(reset, /ensureLamps\(0\)/);
  assert.match(reset, /lampNodes\[i\]\.className = ['"]['"]/);
  assert.match(reset, /barFill\.style\.width = ['"]0%['"]/);
  assert.match(reset, /dialArc\.setAttribute\(['"]stroke-dashoffset['"], String\(RING_C\)\)/);
  assert.match(reset, /dialBead\.style\.display = ['"]none['"]/);
  assert.match(reset, /dialBead\.removeAttribute\(['"]cx['"]\)[\s\S]{0,80}removeAttribute\(['"]cy['"]\)/);
  assert.match(reset, /lastRingKey = ['"]['"];\s*lastRingFraction = 0/);
  for (const field of ['remaining', 'ends', 'dialRemain', 'dialEnds']) {
    assert.match(reset, new RegExp(field + "\\.textContent = ['\\\"]['\\\"]"));
  }
  assert.match(reset,
    /zone\.allowed\.seek === false[\s\S]{0,120}zone\.state === ['"]playing['"][\s\S]{0,120}var live = isLive \? ['"]LIVE['"] : ['"]['"]/);
  assert.match(FACE,
    /position === null[\s\S]{0,180}typeof length !== ['"]number['"][\s\S]{0,120}resetProgress\(zone\)/,
    'either missing position or missing duration takes the full reset branch');
  assert.match(FACE, /dialBead\.style\.display = ['"]['"];\s*var angle/,
    'the first finite frame restores the bead before positioning it');
});

test('disc-face progress rides as a small shaded pearl without changing its position owner', () => {
  assert.match(FACE, /createElementNS\(SVG_NS, ['"]radialGradient['"]\)[\s\S]{0,100}setAttribute\(['"]id['"], ['"]dial-pearl['"]\)/);
  for (const stop of ['glint', 'light', 'tone', 'depth']) {
    assert.match(FACE, new RegExp("['\"]dial-pearl-" + stop + "['\"]"));
    assert.match(CSS, new RegExp('\\[data-ring\\] \\.dial-pearl-' + stop));
  }
  assert.match(CSS, /\[data-ring\] \.dial-bead \{[\s\S]{0,80}fill: url\(#dial-pearl\)/);
  assert.match(FACE, /dialBead\.setAttribute\(['"]r['"], ['"]3\.1['"]\)/);
  assert.match(CSS, /\[data-layout=['"]orbit['"]\] \.dial-bead \{ r: 2\.1; \}/);
  const beadRule = /\[data-ring\] \.dial-bead \{([\s\S]*?)\}/.exec(CSS)?.[1] ?? '';
  assert.doesNotMatch(beadRule, /filter|mask/, 'the pearl remains a cheap SVG fill on Fire TV');
  assert.match(beadRule, /stroke: none/, 'the pearl explicitly retires the flat outline');
  assert.doesNotMatch(beadRule, /stroke-width|rgba\(/, 'no visible rim survives around the shading');
  assert.doesNotMatch(CSS, /\[data-layout=['"]orbit['"]\] \.dial-bead \{[^}]*stroke/,
    'Orbit cannot put the retired rim back');
});

test('a confirmed new cover turns an inner sleeve card while every ring stays still', () => {
  const cardStart = FACE.indexOf("var sleeveFlip = el('div', 'sleeveflip')");
  const ringMount = FACE.indexOf('cover.appendChild(dialBox)');
  assert.ok(cardStart >= 0 && ringMount > cardStart,
    'the rotating card is mounted before, and independently of, the ring');
  assert.match(FACE,
    /sleeveFlip\.appendChild\(sleeveFront\);\s*sleeveFlip\.appendChild\(sleeveBack\);\s*cover\.appendChild\(sleeveFlip\)/);
  assert.match(FACE,
    /shouldFlipCover\(previous, receipt, kind, paintedArtKey,[\s\S]{0,100}albumView === true\)/,
    'one pure gate owns every transition eligibility decision');
  assert.match(FACE, /var coverLoadEpoch = 0/);
  const setCoverStart = FACE.indexOf('function setCover(');
  const setCoverEnd = FACE.indexOf('function setBackdrop(', setCoverStart);
  const setCover = FACE.slice(setCoverStart, setCoverEnd);
  assert.match(setCover,
    /var committed = false[\s\S]{0,220}if \(committed \|\| request !== coverLoadEpoch \|\| key !== artKey\) return/,
    'stale image loads and decode/onload double completion cannot repaint');
  assert.match(FACE,
    /sleeveFlip\.className = ['"]sleeveflip is-resetting['"][\s\S]{0,360}sleeveFlip\.getBoundingClientRect\(\)[\s\S]{0,100}sleeveFlip\.className = ['"]sleeveflip['"]/,
    'the reverse side is promoted without animating a second return turn');
  assert.match(FACE,
    /chooseCoverEffect\(transitionMode, previousEffect, Math\.random\(\)\)[\s\S]{0,180}beginCoverTransition\(next\.src, key, request, effect\)/,
    'the pure repertoire selector feeds the existing conservative cover gate');
  assert.match(CSS, /\.sleeveflip\.effect-flip\.is-flipped \{[^}]*rotateY\(-180deg\)/);
  assert.match(CSS, /\.sleevefront \{[^}]*-webkit-transform: rotateY\(0deg\)[^}]*transform: rotateY\(0deg\)/,
    'legacy Fire TV compositors get an explicit front plane to cull');
  assert.match(CSS, /\.sleeveback \{[^}]*rotateY\(180deg\)/);
  assert.match(CSS,
    /\.sleeveflip\.effect-slide \{ overflow: hidden; \}[\s\S]{0,760}translateX\(-100%\)[\s\S]{0,260}translateX\(0\)/,
    'Slide is clipped to the artwork and replaces left-to-right without touching the ring');
  assert.match(CSS,
    /\.sleeveflip\.effect-dissolve \.sleeveback \{[^}]*opacity: 0[^}]*box-shadow: none[^}]*transition: opacity \.68s[^}]*\}[\s\S]{0,160}\.effect-dissolve\.is-flipped \.sleeveback \{ opacity: 1; \}/,
    'Dissolve fades only the incoming paint while the old sleeve keeps the one stationary shadow');
  assert.match(CSS,
    /\.sleeveflip\.effect-lift \{ overflow: hidden; \}[\s\S]{0,520}translateY\(18%\) scale\(\.94\)[\s\S]{0,420}translateY\(0\) scale\(1\)/,
    'Lift brings the incoming paint forward inside the sleeve boundary');
  assert.match(CSS,
    /\.sleeveflip\.is-resetting \.sleeveside \{[^}]*-webkit-transition: none[^}]*transition: none/,
    'child-plane effects cannot animate a ghost return during promotion');
  assert.doesNotMatch(CSS,
    /\[data-ring\][^,{]*\.cover img\s*\{[^}]*z-index/,
    'nested sleeve images do not create a stale legacy stacking context');
  assert.match(CSS,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,360}\.sleeveflip\.effect-slide \.sleeveside \{[^}]*transition: none[\s\S]{0,260}\.sleeveflip\.effect-lift \.sleeveback \{[^}]*transition: none/,
    'reduced-motion users receive an immediate paint swap for every repertoire member');
  const cssWithoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const effectSelectors = cssWithoutComments.split('{')
    .map((part) => part.slice(part.lastIndexOf('}') + 1).trim())
    .filter((selector) => /\.effect-(?:flip|slide|dissolve|lift)/.test(selector));
  assert.ok(effectSelectors.length >= 12, 'all effect and accessibility selectors are inspected');
  for (const selector of effectSelectors) {
    assert.doesNotMatch(selector, /\.cover(?:\b|[.#:[>+~ ])/,
      'no transition selector may target the outer cover');
    assert.doesNotMatch(selector, /\.dialbox|\.dial(?:\b|[.#:[>+~ ])/,
      'no transition selector may move or fade the progress ring');
  }
  const transitionCssStart = CSS.indexOf('.sleeveflip {');
  const transitionCss = CSS.slice(transitionCssStart, CSS.indexOf('.copy {', transitionCssStart));
  assert.doesNotMatch(transitionCss, /\b(?:filter|mask|clip-path|animation)\s*:/,
    'the television repertoire stays on cheap transform and opacity primitives');
  assert.match(CSS, /data-ring\] \.dialbox \{ z-index: 0; \}/,
    'Dial, Orbit and Rondo keep the progress ring outside and behind the turning sleeve');
});

test('the progress ring is the same raised material without another moving circle', () => {
  const ringStart = FACE.indexOf('function dialRingGradient');
  const ringEnd = FACE.indexOf('var dialTrack =', ringStart);
  const ring = FACE.slice(ringStart, ringEnd);
  assert.match(ring, /createElementNS\(SVG_NS, ['"]radialGradient['"]\)/);
  assert.match(ring, /gradientUnits['"], ['"]userSpaceOnUse['"]/);
  assert.match(ring, /cx['"], ['"]50['"][\s\S]{0,80}cy['"], ['"]50['"][\s\S]{0,80}r['"], ['"]50['"]/);
  assert.ok(ring.includes("var offsets = ['84%', '86.5%', '88%', '89.5%', '92%'];"),
    'the fixed stops straddle the unchanged radius-44 stroke centreline');
  assert.match(ring, /dialRingGradient\(['"]dial-ring-progress['"]/);
  assert.match(ring, /dialRingGradient\(['"]dial-ring-track['"]/);
  assert.doesNotMatch(ring, /filter|mask|animate/i, 'the dimensional paint remains cheap on Fire TV');

  assert.match(CSS, /\.dial-track \{[\s\S]{0,100}stroke: url\(#dial-ring-track\)[\s\S]{0,80}stroke-width: 2\.2/);
  assert.match(CSS, /\.dial-arc \{[\s\S]{0,100}stroke: url\(#dial-ring-progress\)[\s\S]{0,80}stroke-width: 2\.2/);
  const trackStrokes = [...CSS.matchAll(/\[data-ring\] \.dial-track \{([^}]*)\}/g)]
    .filter((match) => /\bstroke\s*:/.test(match[1]));
  const arcStrokes = [...CSS.matchAll(/\[data-ring\] \.dial-arc \{([^}]*)\}/g)]
    .filter((match) => /\bstroke\s*:/.test(match[1]));
  assert.equal(trackStrokes.length, 1, 'no later solid paint can flatten the unplayed ring');
  assert.equal(arcStrokes.length, 1, 'no later solid paint can flatten the progress ring');
  assert.match(CSS, /\[data-layout=['"]orbit['"]\] \.dial-track \{ stroke-width: 1\.3; \}/,
    'Orbit changes only the existing geometry weight, not the dimensional paint');

  const dialBuild = FACE.slice(FACE.indexOf("var dial = document.createElementNS"),
    FACE.indexOf('var dialReading ='));
  assert.equal((dialBuild.match(/createElementNS\(SVG_NS, ['"]circle['"]\)/g) || []).length, 5,
    'track, arc, fill, pearl and transparent hit band remain the only ring circles');
});

test('Search Roon is a deliberate outside-library doorway with no implicit playback', () => {
  assert.match(FACE, /entry\(['"]search['"], ['"]search Roon['"], openRoonSearch\)/);
  assert.match(FACE, /browse-search-entry/);
  assert.match(CSS,
    /\.browse-entry\.browse-search-entry[\s\S]{0,260}flex: 0 0 100%[\s\S]{0,100}width: 100%/,
    'Search owns a full first row while the existing eight choices retain their grid');
  assert.match(FACE, /search: \[[\s\S]{0,160}M10\.8 4\.5/);

  const openStart = FACE.indexOf('function openRoonSearch()');
  const openEnd = FACE.indexOf('/**\n * A row carrying', openStart);
  const open = FACE.slice(openStart, openEnd);
  assert.match(open, /document\.createElement\(['"]input['"]\)/);
  assert.match(open, /input\.type = ['"]search['"]/);
  assert.match(open, /input\.maxLength = 400/);
  assert.match(open, /enterkeyhint/);
  assert.match(open, /form\.addEventListener\(['"]submit['"][\s\S]{0,160}submitSearch\(\)/,
    'keyboard Enter and the visible Search control share one submit path');
  assert.match(open, /pressable\(go, submitSearch, ['"]roon-search-submit['"]\)/);
  assert.match(open, /input\.focus\(\)/, 'the native platform keyboard receives the field');

  const scopeStart = FACE.indexOf('function browseResultSubtitle(item)');
  const scopeEnd = FACE.indexOf('function browseRow(item, onPick)', scopeStart);
  const scope = FACE.slice(scopeStart, scopeEnd);
  assert.match(scope, /browseCtx\.hierarchy === ['"]search['"] && browseCtx\.trail\.length === 1/,
    'scope labels apply only to the root Search result list');
  assert.match(scope, /Results\?\$[\s\S]{0,120}Roon catalogue/,
    'Roon category buckets identify the complete catalogue');
  assert.match(scope, /Albums\?\$[\s\S]{0,120}my library/,
    'the tempting artist shortcut identifies its local-library album count');
  assert.match(FACE,
    /hierarchy === ['"]search['"] && context\.trail\.length === 1[\s\S]{0,100}Search Roon \\u00B7 library \+ catalogue/,
    'the Search result heading retains its scope after the input form is replaced');

  const runStart = FACE.indexOf('function runRoonSearch(value, label)');
  const runEnd = FACE.indexOf('function openRoonSearch()', runStart);
  const run = FACE.slice(runStart, runEnd);
  assert.match(run, /query === ['"]['"][\s\S]{0,100}return false/,
    'blank text is refused before a Roon request');
  assert.match(run,
    /browseCall\(\{\s*hierarchy: ['"]search['"],\s*popAll: true,\s*input: query,\s*sessionKey: browseSessionKey,\s*\}\)[\s\S]{0,220}browseDraw\(result, epoch, context\)/);
  assert.doesNotMatch(run, /itemKey|zoneId|browseInto\(|action:\s*['"]play/,
    'Search only draws Roon results; choosing and playing remain explicit');
});

test('a Recent row starts an honest fresh Roon Search without guessing a match', () => {
  const start = FACE.indexOf('function recentTrackRow(t)');
  const end = FACE.indexOf('/* ---------- transport ----------', start);
  const recent = FACE.slice(start, end);
  const searchStart = recent.indexOf('function searchRecentTrack(track)');
  const searchEnd = recent.indexOf('function recentStationMatch(track, stations)', searchStart);
  const search = recent.slice(searchStart, searchEnd);
  assert.match(recent, /line2: line2/,
    'the ledger credit survives in the client row data');
  assert.match(recent, /line2\.split\(['"] \/ ['"]\)\[0\]/,
    'only the primary line2 credit contributes to the query');
  assert.match(recent, /var query = String\(t\.title \|\| ['"]['"]\)[\s\S]{0,100}credit/);
  assert.match(search, /runRoonSearch\(track\.query, track\.title\)/,
    'Recent delegates its remembered words to the same fresh Search doorway');
  assert.doesNotMatch(search, /itemKey|browseInto\(|action:\s*['"]play/,
    'an ordinary Recent track neither reuses an expired key nor auto-selects or plays a match');
  assert.match(FACE,
    /function browseRow\(item, onPick\)[\s\S]{0,180}item\.intent[\s\S]{0,160}aria-label/,
    'the row tells pointer and assistive users that choosing it means Search');
});

test('Search typing and Browse D-pad navigation own their keys before global Face shortcuts', () => {
  const keysStart = FACE.indexOf('function onKey(event)');
  const keysEnd = FACE.indexOf('// Capture on window AND document', keysStart);
  const keys = FACE.slice(keysStart, keysEnd);
  const textGuard = keys.indexOf('isTextEntry(target) || isTextEntry(active)');
  const classify = keys.indexOf('keyName(event)');
  const browseKeys = keys.indexOf('handleBrowseNavigation(name, event)');
  const pickerKeys = keys.indexOf('handlePickerNavigation(name)');
  assert.ok(textGuard >= 0 && textGuard < classify,
    'the input guard wins before letters can become transport shortcuts');
  assert.ok(browseKeys > classify && browseKeys < pickerKeys,
    'Browse owns navigation before the picker or global volume/artwork handlers');
  assert.match(keys, /event\.target[\s\S]{0,100}document\.activeElement/);
  assert.match(FACE,
    /function isTextEntry\(node\)[\s\S]{0,220}tag === ['"]INPUT['"] \|\| tag === ['"]TEXTAREA['"]/);
  assert.match(FACE, /function isTextEntry\(node\)[\s\S]{0,260}isContentEditable|contenteditable/);

  const local = /function handleBrowseNavigation\(name, event\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(local, /name === ['"]up['"][\s\S]*name === ['"]down['"][\s\S]*name === ['"]ok['"]/);
  assert.match(local, /name === ['"]left['"][\s\S]{0,180}browseBack\(\)/);
  assert.match(local, /name === ['"]right['"][\s\S]{0,80}return true/,
    'Right cannot change the face behind an open Browse window');
  assert.match(FACE, /function setBrowseNavigation[\s\S]{0,520}scrollIntoView/);
  assert.match(FACE, /\['pointermove'[\s\S]{0,160}['"]input['"]\]/,
    'Silk virtual-keyboard edits keep the Browse inactivity deadline alive');
  assert.match(CSS, /\.browse \[role="button"\]\.browse-key-current/);
  assert.match(CSS, /\.browse-search-input:focus/);
});

test('one Fire TV centre hold can activate only one Browse level', () => {
  const local = /function handleBrowseNavigation\(name, event\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(local,
    /name === ['"]ok['"][\s\S]{0,260}event\.repeat === true[\s\S]{0,160}now < browseOkHeldUntil/);
  assert.match(local, /browseOkHeldUntil = now \+ PRESS_ECHO_MS[\s\S]{0,100}activateBrowseNavigation\(\)/);
  const release = /function releaseBrowseOk\(event\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(release, /keyName\(event\) !== ['"]ok['"]/);
  assert.ok(release.indexOf('keyName(event)') < release.indexOf('event.stopPropagation()'),
    'keyup is consumed before a rebuilt result row can receive it');
  assert.match(FACE, /window\.addEventListener\(['"]keyup['"], releaseBrowseOk, true\)/);
  assert.match(FACE, /document\.addEventListener\(['"]keyup['"], releaseBrowseOk, true\)/);
  assert.match(FACE,
    /isTextEntry\(target\) \|\| isTextEntry\(active\)[\s\S]{0,320}keyName\(event\) === ['"]ok['"][\s\S]{0,100}browseOkHeldUntil = Date\.now\(\) \+ PRESS_ECHO_MS/,
    'native Search Enter arms the same tail latch without taking over the input');
  assert.match(release, /isTextEntry\(document\.activeElement\)/);
  assert.ok(release.indexOf("keyName(event) !== 'ok'")
      < release.indexOf('isTextEntry(document.activeElement)')
    && release.indexOf('isTextEntry(document.activeElement)') < release.indexOf('event.preventDefault()'),
  'native keyup remains with a still-focused Search field but is consumed after results take focus');

  const into = /function browseInto\(item\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  const pending = into.indexOf('browsePending');
  const request = into.indexOf('browseCall(call)');
  assert.ok(pending >= 0 && pending < request, 'a second row cannot mutate the Browse stack in flight');
  assert.match(into, /browseCtx === null \|\| browsePending/);
});

test('native Go focus wins and every late Browse callback is fenced to its exact panel', () => {
  assert.match(FACE,
    /function browseNavigationIndex\(choices\)[\s\S]{0,180}document\.activeElement[\s\S]{0,220}setBrowseNavigation\(active\)/,
    'Enter on the visibly focused Go control cannot fall back to the header X');
  assert.match(FACE,
    /function activateBrowseNavigation\(\)[\s\S]{0,180}browseNavigationIndex\(choices\)[\s\S]{0,120}browseNavigationCurrent\.click/);

  assert.match(FACE,
    /function beginBrowse\(context\)[\s\S]{0,160}browseEpoch \+= 1[\s\S]{0,100}browseCtx = context/);
  assert.match(FACE,
    /function browseIsCurrent\(epoch, context, node\)[\s\S]{0,180}epoch !== browseEpoch[\s\S]{0,100}context !== browseCtx/);
  assert.match(FACE, /function closeBrowse\(\)[\s\S]{0,180}browseEpoch \+= 1/);
  assert.match(FACE, /function browseDraw\(result, epoch, context\)[\s\S]{0,100}!browseIsCurrent\(epoch, context\)/);

  const findLetter = /function findLetter\(hierarchy, letter, total, epoch, context, list, done\)([\s\S]*?)\n\}/
    .exec(FACE)?.[1] ?? '';
  assert.match(findLetter,
    /browseIsCurrent\(epoch, context, list\)[\s\S]{0,260}probeTitle\(hierarchy, mid\)[\s\S]{0,180}browseIsCurrent\(epoch, context, list\)/,
    'an obsolete alphabet bisection stops before it can queue more work on the shared Browse session');
  assert.match(FACE,
    /findLetter\(hierarchy, letter, total, epoch, context, list, function \(offset\)/);

  const search = /function runRoonSearch\(value, label\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(search, /var epoch = beginBrowse\(context\)/);
  assert.match(search,
    /then\(function \(result\) \{[\s\S]{0,100}!browseIsCurrent\(epoch, context\)[\s\S]{0,140}browseDraw\(result, epoch, context\)/);
  assert.match(search,
    /catch\(function \(\) \{[\s\S]{0,100}!browseIsCurrent\(epoch, context\)[\s\S]{0,180}closeBrowse\(\)/,
    'an old Search error cannot close a newly opened panel');

  const draw = /function browseDraw\(result, epoch, context\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.ok((draw.match(/browseIsCurrent\(epoch, context, list\)/g) || []).length >= 4,
    'initial load, alphabet jump, page load and errors all verify the live panel');
  assert.match(FACE,
    /function openRecent\(\)[\s\S]{0,180}beginBrowse\(null\)[\s\S]{0,500}browseIsCurrent\(epoch, context, list\)/,
    'the local Recent fetch cannot repaint a newer Browse window either');
});

test('Recent safely remembers stations without weakening track discovery', () => {
  const start = FACE.indexOf('function recentTrackRow(t)');
  const end = FACE.indexOf('/* ---------- transport ----------', start);
  const recent = FACE.slice(start, end);

  assert.match(FACE,
    /var recentRadioSessionKey = ['"]recent-radio-['"] \+ String\(Date\.now\(\)\)\.slice\(-8\)[\s\S]{0,100}Math\.random/,
    'station lookup has a page-private stack distinct from ordinary Browse');
  assert.match(recent,
    /function loadRecentStations\(\)[\s\S]{0,220}hierarchy: ['"]internet_radio['"],[\s\S]{0,80}popAll: true,[\s\S]{0,100}sessionKey: recentRadioSessionKey[\s\S]{0,360}load: true,[\s\S]{0,100}sessionKey: recentRadioSessionKey/,
    'a station action always comes from a fresh Live Radio root and load');

  const match = /function recentStationMatch\(track, stations\)([\s\S]*?)\n\}/.exec(recent)?.[1] ?? '';
  assert.match(match, /station\.hint !== ['"]action['"]/);
  assert.match(match, /typeof station\.itemKey !== ['"]string['"]/);
  assert.match(match, /String\(station\.title \|\| ['"]['"]\) !== track\.title/);
  assert.match(match, /track\.artKey !== null && station\.imageKey === track\.artKey/,
    'title plus artwork is the primary station identity');
  assert.match(match, /exactMatches\.length > 0[\s\S]{0,80}exactMatches\[0\]/);
  assert.match(match,
    /track\.line2 === ['"]['"] && titleMatches\.length === 1 \? titleMatches\[0\] : null/,
    'a changed logo may fall back only for a blank-credit station card with one unique saved name');

  assert.match(recent, /var seenStations = \{\}/);
  assert.match(recent, /if \(seenStations\[stationName\] === true\) continue/,
    'repeat tune-ins collapse to the newest station row');
  assert.match(recent, /subtitle: ['"]Rejoin live/);
  assert.match(FACE, /if \(item\.rejoinLive === true\) return ['"]radio['"]/,
    'the promoted row visibly means broadcast rather than track');
  assert.match(recent, /return stationRows\.concat\(trackRows\)/,
    'station actions are separate while unmatched broadcast tracks remain discoveries');

  const rejoin = /function rejoinRecentStation\(row\)([\s\S]*?)\n\}/.exec(recent)?.[1] ?? '';
  assert.match(rejoin, /itemKey: station\.itemKey/);
  assert.match(rejoin, /zoneId: zone\.id/);
  assert.match(rejoin, /sessionKey: recentRadioSessionKey/);
  assert.match(rejoin, /searchRecentTrack\(row\.track\)/,
    'a malformed or no-longer-safe station row falls back to the ordinary Search meaning');
  assert.match(recent,
    /drawRecentRows\(list, tracks, \[\]\)[\s\S]{0,120}loadRecentStations\(\)/,
    'Recent never hangs behind station discovery; safe track searches render first');
});

test('an open picker owns Fire TV Up, Down and Enter before global shortcuts', () => {
  const choices = /function pickerNavigationChoices\(\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(choices, /aria-disabled/);
  assert.match(choices, /classes\.indexOf\(['"] off ['"]\)/);
  assert.match(FACE, /function setPickerNavigation[\s\S]{0,520}scrollIntoView/);
  assert.match(FACE,
    /var preservedNavigation = refreshing \? pickerNavigationIdentity\(pickerNavigationCurrent\) : ['"]['"]/);
  const presentStart = FACE.indexOf('function presentPicker(');
  const presentEnd = FACE.indexOf('function showPicker(', presentStart);
  const present = FACE.slice(presentStart, presentEnd);
  assert.match(present, /seedPickerNavigation\(refreshing \? preservedNavigation : ['"]['"]\)/,
    'the one presentation seam seeds every body-owned and in-layout picker');
  const keysStart = FACE.indexOf('function onKey(event)');
  const keysEnd = FACE.indexOf('// Capture on window AND document', keysStart);
  const keys = FACE.slice(keysStart, keysEnd);
  const local = keys.indexOf('handlePickerNavigation(name)');
  assert.ok(local >= 0 && local < keys.indexOf("name === 'up'") && local < keys.indexOf('cycleFace(-1)'),
    'picker-local navigation is decided before volume, artwork or face mappings');
  const pickerKeys = /function handlePickerNavigation\(name\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(pickerKeys, /picker\.hidden \|\| browsePanel !== null/);
  assert.match(pickerKeys, /name === ['"]up['"][\s\S]*name === ['"]down['"][\s\S]*name === ['"]ok['"]/);
  assert.match(pickerKeys, /mode-transport[\s\S]*return false/,
    'visible transport chrome must not steal the global volume and artwork keys');
  assert.match(FACE, /function activatePickerNavigation[\s\S]{0,520}\.click\(\)/);
  assert.match(CSS, /\.picker \[role="button"\]\.picker-key-current/);
});

test('a group transition follows the durable leader output instead of the destroyed zone id', () => {
  assert.match(FACE, /boundOutputId = z\.outputs\.length > 0 \? z\.outputs\[0\]\.id : null/,
    'choosing a room rebinds the session to that room rather than clearing its durable identity');
  assert.match(FACE,
    /body\.action === ['"]group['"][\s\S]*var anchor = currentZone\(\)[\s\S]*boundOutputId === null[\s\S]*boundOutputId = anchor\.outputs\[0\]\.id/,
    'an unbound player display anchors before Roon destroys its current zone');
  assert.match(FACE,
    /var chosenZone = zoneById\(chosen\)[\s\S]*boundOutputId = chosenZone !== null[\s\S]*chosenZone\.outputs\[0\]\.id/,
    'remote room selection also binds the chosen leader output');
});

test('passive movement cannot continually extend the chrome deadline', () => {
  assert.match(FACE, /if \(chromeTimer !== null && !extend\) return/);
  assert.match(FACE, /Math\.abs\(x - lastPassiveX\) \+ Math\.abs\(y - lastPassiveY\) >= 6/);
  assert.match(FACE, /document\.addEventListener\(kind, revealChromeFromMovement, true\)/);
  assert.doesNotMatch(FACE, /document\.addEventListener\(kind, revealChrome, true\)/);
});

test('paused and stopped players wait for the selected idle deadline before becoming a clock', () => {
  assert.match(FACE, /import \{ createIdleDelayPolicy \} from ['"]\.\/idle-delay\.js['"]/);
  assert.match(FACE, /delayMinutes: 15/);
  assert.match(FACE, /inactive = np === null \|\| zone\.state === ['"]paused['"] \|\| zone\.state === ['"]stopped['"]/);
  assert.match(FACE, /idleNow = idlePolicy\.reconcile\(zone\.id, inactive, np !== null\)/);
  assert.match(FACE, /root\.setAttribute\(['"]data-idle['"], idleNow \? ['"]1['"] : ['"]0['"]\)/);
  assert.doesNotMatch(CSS, /data-state="stopped"\] \.copy/,
    'stopped state alone cannot bypass the selected delay');
  assert.match(FACE, /if \(np !== null\)[\s\S]{0,900}idlePolicy\.markPainted\(zone\.id\)/,
    'null now-playing can retain only content the policy saw painted for this room');
  const hello = /function sayHello\(\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.ok(hello.indexOf('idlePolicy.setDelay(data.idleDelayMinutes)')
    < hello.indexOf('!outputChanged && !delayChanged'),
  'a saver-only settings change reaches an already-correct room binding');
  assert.match(FACE, /function updateIdleClock\(\)[\s\S]{0,500}300000/,
    'the clock stays current and moves gently rather than burning one position');
  assert.match(CSS, /\.face\[data-idle="1"\] \.np,[\s\S]{0,80}\.foot \{ display: none !important; \}/,
    'the clock replaces the music composition instead of covering it');
  assert.match(FACE, /root\.getAttribute\(['"]data-idle['"]\) === ['"]1['"]\)\) showPicker\(['"]transport['"]\)/,
    'a deliberate press can still reach Play');
});

test('linear progress, picker and chrome consume one layout rail', () => {
  assert.match(CSS, /data-layout="classic"\] \.shelf \.controls \{ width: 100%; \}/);
  assert.match(CSS, /data-layout="classic"\] \.foot[\s\S]*width: 52\.6vw/);
  assert.match(CSS, /data-layout="classic"\] \.headmark \{ width: 34vw; \}/,
    'Classic keeps the relocated Face mark on the artwork rail');
  assert.match(CSS, /--flightdeck-rail-width: 46vw/);
  assert.match(CSS, /data-layout="libretto"\] \{ --flightdeck-rail-width: 62vw; \}/);
  assert.match(CSS, /\.foot[\s\S]*width: var\(--flightdeck-rail-width\)/);
  assert.match(CSS, /\.copy > \.picker[\s\S]*width: var\(--flightdeck-rail-width\)/);
  assert.match(CSS, /\.copy > \.picker[\s\S]*left: auto; right: 5vw/);
  assert.match(CSS, /\.copy > \.picker,\s*\n[^\n]*\.copy > \.browse/);
});

test('the runway playhead cannot inherit the absolutely positioned page-header class', () => {
  assert.match(FACE, /zone\.state === ['"]playing['"] \? ['"]lamp-head['"] : ['"]['"]/);
  assert.match(CSS, /\.lamps b\.lamp-head/);
  assert.match(CSS, /\.lamps b:not\(\.lit\):not\(\.lamp-head\)/);
  assert.doesNotMatch(CSS, /\.lamps b\.head/);
  assert.doesNotMatch(FACE, /zone\.state === ['"]playing['"] \? ['"]head['"] : ['"]['"]/);
  assert.match(FACE, /foot\.setAttribute\(['"]title['"], ['"]press to seek['"]\)/,
    'renaming the lamp state must not remove the progress rail seek affordance');
});

test('Dial and Orbit browse is viewport-owned and cannot move with the artwork', () => {
  const shellStart = FACE.indexOf('function browseShell(title, canGoBack)');
  const shellEnd = FACE.indexOf('function browseResultSubtitle(item)', shellStart);
  const shell = FACE.slice(shellStart, shellEnd);
  assert.match(shell,
    /var inMainCircle = root\.getAttribute\(['"]data-ringlayout['"]\) === ['"]1['"][\s\S]{0,160}data-size[\s\S]{0,100}data-idle/);
  assert.match(shell, /var host = inMainCircle \? document\.body/,
    'the window cannot bubble into or move with the pressable cover');
  assert.doesNotMatch(shell, /inMainCircle \? dialBox|dialBox\.classList\.add\(['"]has-browse/);
  assert.match(shell, /browsePanel\.setAttribute\(['"]data-over-ring['"], ['"]1['"]\)/);
  assert.match(shell,
    /inMainCircle && root\.getAttribute\(['"]data-view['"]\) === ['"]artist['"][\s\S]{0,140}data-artist-rail/,
    'an artist-view disc cascade stays on the same right-hand working rail');
  assert.match(shell,
    /\[['"]touchstart['"], ['"]click['"], ['"]pointerup['"], ['"]touchend['"], ['"]mouseup['"], ['"]keyup['"]\][\s\S]{0,180}event\.stopPropagation\(\)/,
    'every event understood by the cover stops at the Browse boundary, including Space keyup');
  assert.doesNotMatch(shell, /event\.preventDefault\(\)/,
    'the boundary must not disturb native input, voice keyboard or scrolling');
  assert.match(CSS,
    /body > \.browse\[data-over-ring="1"\] \{[\s\S]{0,180}position: fixed; left: 50%; top: 50%; width: 48vw; height: 72vh[\s\S]{0,220}z-index: 60/);
  assert.match(CSS, /body > \.browse\[data-over-ring="1"\][\s\S]{0,260}translate\(-50%, -50%\)/);
  assert.match(CSS, /body > \.browse\[data-over-ring="1"\] \.browse-row[\s\S]{0,120}flex-wrap: nowrap/);
  assert.match(CSS, /body > \.browse\[data-over-ring="1"\] \.browse-name[\s\S]{0,160}width: auto/);
  assert.doesNotMatch(CSS, /dialbox(?:\.has-browse| > \.browse)/,
    'no Browse rule may restore the cover as its event or positioning ancestor');
  assert.match(CSS, /\.copy > \.browse[\s\S]{0,220}top: 11vh; bottom: 9vh/);
});

test('ring artist view stays still and its exact sleeve always returns to album mode', () => {
  const buildStart = FACE.indexOf("var sleeveFlip = el('div', 'sleeveflip')");
  const buildEnd = FACE.indexOf("var copy = el('div', 'copy')", buildStart);
  const build = FACE.slice(buildStart, buildEnd);
  assert.match(build,
    /cover\.appendChild\(sleeveFlip\)[\s\S]{0,760}var albumReturn = el\(['"]span['"], ['"]album-return['"]\)[\s\S]{0,180}cover\.appendChild\(albumReturn\)/,
    'the return target is the visible square, above the inert transition planes');
  assert.match(FACE, /function returnToAlbum\(\)[\s\S]{0,180}viewStep = VIEW_ALBUM[\s\S]{0,80}artistIndex = -1/);
  const flipStart = FACE.indexOf('function flipArtwork()');
  const flipEnd = FACE.indexOf('function returnToAlbum()', flipStart);
  assert.match(FACE.slice(flipStart, flipEnd),
    /root\.getAttribute\(['"]data-view['"]\) === ['"]artist['"][\s\S]{0,80}returnToAlbum\(\)/,
    'the painted artist view wins even if asynchronous bookkeeping drifts');
  assert.match(FACE, /pressable\(albumReturn, returnToAlbum, ['"]artist-album-return['"]\)/,
    'all supported television pointer events share one deduplicated return action');
  assert.match(FACE, /albumReturn\.setAttribute\(['"]tabindex['"], ['"]-1['"]\)/,
    'the nested pointer target does not become a duplicate remote focus stop');
  assert.match(CSS,
    /\.album-return \{[\s\S]{0,180}z-index: 2[\s\S]{0,100}pointer-events: none[\s\S]{0,140}data-view="artist"\] \.album-return \{ pointer-events: auto/,
    'only artist view activates the exact sleeve-sized target');
  const artistDiscChromeRules = (CSS.match(/\.face[^\n{]*show-chrome[^\n{]*data-ringlayout[^\n{]*data-view="artist"[^\n{]*\{/g) || [])
    .filter((selector) => !selector.includes(':not([data-view="artist"])'));
  for (const selector of artistDiscChromeRules) {
    assert.doesNotMatch(selector, /\.(?:body|np|cover|copy|dialbox|dial-reading|dial-times)(?:\s|\{|$)/,
      'artist chrome may place its shelves but never shrink, lift or reflow the disc composition');
  }
  const ringChromeRules = (CSS.match(/\.face[^\n{]*show-chrome[^\n{]*data-ringlayout[^\n{]*\{/g) || [])
    .filter((selector) => /\.(?:body|np|cover|copy|dialbox|dial-reading|dial-times)(?:\s|\{|$)/.test(selector));
  assert.ok(ringChromeRules.length >= 2, 'the ordinary ring composition geometry remains covered');
  for (const selector of ringChromeRules) {
    assert.match(selector, /:not\(\[data-view="artist"\]\)/,
      'every ring chrome geometry rule must explicitly leave artist view stationary');
  }
  assert.match(CSS,
    /show-chrome\[data-layout="dial"\]:not\(\[data-view="artist"\]\) \.dial-times/,
    'Dial reading typography remains stationary with the rest of artist view');
  assert.match(CSS,
    /show-chrome\[data-flank\]:not\(\[data-view="artist"\]\) \.body/,
    'the later flank centering rule cannot override the artist anchor');
  const contrastStart = CSS.indexOf('Artist photographs are uncontrolled content');
  const contrastEnd = CSS.indexOf('/* ⚖️ MUTE, PICKER', contrastStart);
  const contrast = CSS.slice(contrastStart, contrastEnd);
  for (const host of ['headmark', 'headtools', 'shelf-browse', 'shelf-transport', 'shelf-volume']) {
    assert.match(contrast, new RegExp('show-chrome\\[data-view="artist"\\][^\\n]*\\.' + host),
      host + ' receives an active artist-view contrast ground');
  }
  assert.match(contrast, /background: rgba\(10,11,13,\.78\)/);
  assert.match(contrast, /border: 1px solid rgba\(242,238,230,\.34\)/);
  const railStart = CSS.indexOf('DISC ARTIST VIEW USES ONE RIGHT-HAND WORKING RAIL');
  const railEnd = CSS.indexOf('/* ⚖️ MUTE, PICKER', railStart);
  const rail = CSS.slice(railStart, railEnd);
  assert.match(rail,
    /show-chrome\[data-ringlayout\]\[data-view="artist"\] \.shelf \{[\s\S]{0,140}right: 5vw[\s\S]{0,80}width: 34vw/,
    'Dial and Orbit share one right-side artist rail');
  assert.match(rail, /\.shelf-transport \{\s*top: 17vh/);
  assert.match(rail, /\.shelf-volume \{\s*top: 28vh/);
  assert.match(rail, /\.shelf-browse \{\s*top: 40vh/,
    'controls rise and Browse follows beneath in a deliberate vertical rhythm');
  assert.match(rail,
    /body > \.browse\[data-over-ring="1"\]\[data-artist-rail="1"\] \{[\s\S]{0,180}right: 5vw[\s\S]{0,120}width: 34vw[\s\S]{0,120}transform: none/,
    'the opened cascade operates on the same side without covering the portrait');
});

test('browse closes successful leaf choices while hierarchy drill-down stays open', () => {
  assert.match(FACE,
    /function browseSelectionComplete\(item, result\)[\s\S]{0,180}result\.isError === true[\s\S]{0,180}item\.hint === ['"]action['"]/,
    'a failed action remains visible, while an action-hinted leaf is terminal');
  assert.match(FACE,
    /if \(browseSelectionComplete\(item, result\)\)[\s\S]{0,180}closeBrowse\(\)[\s\S]{0,80}return/,
    'a successful final choice dismisses the browse window');
  assert.match(FACE,
    /if \(result\.isError === true\)[\s\S]{0,120}return[\s\S]{0,120}context\.trail\.push[\s\S]{0,100}browseDraw\(result, epoch, context\)/,
    'errors stay put and non-terminal list rows continue down the hierarchy');
  assert.match(FACE, /shut\.setAttribute\(['"]aria-label['"], ['"]cancel browse['"]\)/,
    'the X remains an explicit cancel action');
});

test('Live Radio keeps station artwork and an honest radio fallback', () => {
  const iconStart = FACE.indexOf('function iconFor(item, hierarchy)');
  const radioRule = FACE.indexOf("if (hierarchy === 'internet_radio') return 'radio';", iconStart);
  const actionRule = FACE.indexOf("if (item.hint === 'action')", iconStart);
  assert.ok(iconStart >= 0 && radioRule > iconStart && radioRule < actionRule,
    'an action-hinted station must be classified by its Live Radio hierarchy first');
  assert.match(FACE,
    /if \(item\.hint === ['"]action['"]\)[\s\S]{0,260}title\.indexOf\(['"]radio['"]\) >= 0\) return ['"]shuffle['"]/,
    'Start Radio actions outside the station hierarchy remain distinct');
  const rowStart = FACE.indexOf('function browseRow(item, onPick)');
  const artBranch = FACE.indexOf('if (item.art)', rowStart);
  const fallback = FACE.indexOf('iconFor(item, browseCtx', rowStart);
  assert.ok(rowStart >= 0 && artBranch > rowStart && fallback > artBranch,
    'real station artwork wins, with the radio mark used only as its fallback');
});

test('mute has a dedicated mark and the central transport controls use the spare rail', () => {
  assert.match(FACE, /function glyphMute\(\)[\s\S]*M4\.7 4\.7l14\.8 14\.8/);
  assert.match(FACE, /previousBtn\.className \+= ['"] is-skip['"]/);
  assert.match(FACE, /nextBtn\.className \+= ['"] is-skip['"]/);
  assert.match(FACE, /node\.appendChild\(glyphMute\(\)\)/);
  assert.match(CSS, /\.ctl\.is-skip \{ min-width: 5\.8vw; \}/);
  assert.match(CSS, /\.ctl\.is-play[\s\S]*min-width: 6\.8vw/);
});

test('multizone mute sends one honest intent and repaints room and group state', () => {
  const roomSpeaker = /function volumeSpeaker\(output\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  const groupSpeaker = /function groupVolumeSpeaker\(zone, outputs, allMuted\)([\s\S]*?)\n\}/.exec(FACE)?.[1] ?? '';
  assert.match(FACE, /row\.appendChild\(volumeSpeaker\(o\)\)/,
    'a member button must govern that output, not mistake its numeric level for an output list');
  assert.doesNotMatch(FACE, /volumeSpeaker\(o,\s*v\.muted/,
    'the old mismatched call produced an empty governed-id list and sent no request');
  assert.match(roomSpeaker,
    /outputById\(output\.id\)[\s\S]*action: ['"]mute['"][\s\S]{0,120}muted: !live\.volume\.muted/,
    'a room rereads its own live mute state and sends one explicit toggle');
  assert.match(groupSpeaker, /action: ['"]group-mute['"], zone: live\.id/,
    'a group master sends one server-owned action rather than racing browser requests');
  assert.match(FACE,
    /var allMuted = mutable\.length > 0;[\s\S]{0,220}!mutable\[gm\]\.volume\.muted[\s\S]{0,180}paintMuteNode\(volUi\.speaker, allMuted/,
    'the master colour represents the whole live group, including mixed state');
  assert.match(FACE,
    /function paintMemberVolumes\(\)[\s\S]{0,420}paintMuteNode\(speakers\[i\], !!vol\.muted, output\.name\)/,
    'member colour follows the Roon snapshot rather than changing optimistically');
});
