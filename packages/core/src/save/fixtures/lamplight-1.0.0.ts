/**
 * A save file made by version 1.0.0 of a small game, "lamplight", for the
 * migration tests (#100): the hero holds the old lamp (ID `oldLamp`), near
 * the shed, with the door open (`shut: false`), in the passage "Yard". It's
 * the file's text exactly as `writeSave` wrote it; don't edit it by hand.
 */
export const lamplight100 =
  '{"format":"loominate-save","version":1,"game":{"id":"lamplight","version":"1.0.0"},"engine":"0.1.0","savedAt":"2026-01-01T12:00:00.000Z","label":"In the yard","state":{"$actions":{"0":{"type":"follow","choice":{"type":"link","target":"Yard","label":"Open the door"}},"length":1},"$attempts":{"0":1},"$events":{"0":{"to":"Start","seq":0,"kind":"navigation","tags":[]},"1":{"from":"Start","to":"Yard","seq":1,"kind":"navigation","tags":[]},"2":{"passage":"Yard","phase":"enter","seq":2,"kind":"phase","tags":[]},"length":3},"$persistent":{"atBegin":{}},"$random":{"move":"0.0","seed":"fixture"},"$story":{"current":"Yard"},"$visits":{"Start":1,"Yard":1},"door":{"shut":false},"hero":{"holding":{"$ref":"oldLamp"},"near":{"$ref":"shed"}},"oldLamp":{"oil":2}}}\n\n';
