const ws = new WebSocket((await (await fetch("http://localhost:9222/json")).json())[0].webSocketDebuggerUrl);
ws.addEventListener("open", () => {
  ws.send(JSON.stringify({id:1, method:"Runtime.evaluate", params:{expression:'localStorage.getItem("fanta-asta-desktop")', returnByValue:true}}));
});
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id === 1) {
    const data = JSON.parse(msg.result.result.value);
    let filtered = data.data.players.filter(p => p.zone === "def" && p.sold === false);
    filtered.sort((a,b) => a.name.localeCompare(b.name));
    const idx = filtered.findIndex(p => p.name === "Bremer");
    console.log("Bremer index in def/name-sorted/unsold list:", idx);
    console.log("neighbors:", filtered.slice(Math.max(0,idx-2), idx+3).map(p=>p.name));

    // Simula la ricerca: aggiorna il selector a puntare su Bremer
    data.data.selector = { sortType: "name", zoneFilter: "def", soldFilter: true, randomSeed: data.data.randomSeed, cursor: idx, garbage: [] };
    const newValue = JSON.stringify(data);
    const wsSet = new WebSocket((ws.url));
  }
});
