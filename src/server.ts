
import express, { Application, Request, Response } from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";

import { Map, Match, Team, Player, CreateMatchParams } from "./types";

let matches: Match[] = [];

const maps: Map[] = [
    { mapId: 1, name: "Mirage" },
    { mapId: 2, name: "Dust2" },
    { mapId: 3, name: "Inferno" },
    { mapId: 4, name: "Nuke" },
    { mapId: 5, name: "Overpass" },
];

const weapons = [
    { weaponId: 1, name: "USP-S" },
    { weaponId: 11, name: "AK-47" },
    { weaponId: 12, name: "AWP" },
    { weaponId: 15, name: "M4A4" },
];

function getRandomWeaponId(): number {
    const randIndex = Math.floor(Math.random() * weapons.length);
    return weapons[randIndex].weaponId;
}

function createPlayers(playerNames: string[], teamPlayersCount: number): Player[] {
    const limitedNames = playerNames.slice(0, teamPlayersCount);

    return limitedNames.map<Player>((name) => {
        return {
            id: uuidv4(),
            name,
            kills: 0,
            deaths: 0,
            helps: 0,
            kd: 0,
            dead: false,
            weaponId: getRandomWeaponId(),
            moneyCount: 800,
        };
    });
}

function createMatch(params: CreateMatchParams): Match {
    // console.log(params);
    const { mapId, team1, team2, teamPlayersCount } = params;

    const foundMap = maps.find((m) => m.mapId === mapId) || maps[0];

    const match: Match = {
        matchId: uuidv4(),
        mapId: foundMap.mapId,
        timer: 90,
        round: 1,
        roundsHistory: [],
        team1: {
            side: "CT",
            winRounds: 0,
            players: createPlayers(team1, teamPlayersCount),
        },
        team2: {
            side: "TT",
            winRounds: 0,
            players: createPlayers(team2, teamPlayersCount),
        },
        killFeed: [],
    };
    // console.log("create", match)

    return match;
}

function checkRoundEnd(match: Match, io: SocketIOServer): void {
    const aliveTeam1 = match.team1.players.filter((p) => !p.dead).length;
    const aliveTeam2 = match.team2.players.filter((p) => !p.dead).length;

    if (aliveTeam1 === 0 || aliveTeam2 === 0) {
        let winningTeam: Team | null = null;

        if (aliveTeam1 > 0) {
            winningTeam = match.team1;
        } else if (aliveTeam2 > 0) {
            winningTeam = match.team2;
        }

        if (winningTeam) {
            winningTeam.winRounds += 1;
            match.roundsHistory.push(winningTeam === match.team1 ? 1 : 2);
        }

        match.round += 1;

        if (match.round === 13) {
            const tempSide = match.team1.side;
            match.team1.side = match.team2.side;
            match.team2.side = tempSide;
        }

        match.team1.players.forEach((p) => (p.dead = false));
        match.team2.players.forEach((p) => (p.dead = false));

        match.timer = 90;
        // console.log(match)

        io.emit("matchUpdate", match);
    }
}

function simulateKill(io: SocketIOServer) {
    if (matches.length === 0) return;

    const randomMatchIndex = Math.floor(Math.random() * matches.length);
    const match = matches[randomMatchIndex];
    if (!match) return;

    const alivePlayers = [
        ...match.team1.players.filter((p) => !p.dead),
        ...match.team2.players.filter((p) => !p.dead),
    ];
    if (alivePlayers.length < 2) {
        checkRoundEnd(match, io);
        return;
    }

    const killerIndex = Math.floor(Math.random() * alivePlayers.length);
    let victimIndex = Math.floor(Math.random() * alivePlayers.length);
    while (victimIndex === killerIndex) {
        victimIndex = Math.floor(Math.random() * alivePlayers.length);
    }

    const killer = alivePlayers[killerIndex];
    const victim = alivePlayers[victimIndex];

    killer.kills += 1;
    victim.deaths += 1;
    victim.dead = true;

    killer.kd = killer.deaths === 0
        ? killer.kills
        : parseFloat((killer.kills / killer.deaths).toFixed(2));

    match.killFeed.push({
        killerId: killer.id,
        victimId: victim.id,
        weaponId: killer.weaponId,
        timestamp: Date.now(),
    });

    if (match.killFeed.length > 15) {
        match.killFeed.shift();
    }
    // console.log(match)

    io.emit("matchUpdate", match);

    checkRoundEnd(match, io);
}


const app: Application = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: "*",
    },
});

app.use(cors());
app.use(express.json());


app.post("/matches", (req: Request<{}, {}, CreateMatchParams>, res: Response) => {
    const { mapId, team1, team2, teamPlayersCount } = req.body;

    if (!mapId || !team1 || !team2 || !teamPlayersCount) {
        return res.status(400).json({ error: "mapId, team1, team2, teamPlayersCount are required" });
    }

    const newMatch = createMatch({ mapId, team1, team2, teamPlayersCount });
    matches.push(newMatch);

    return res.status(201).json(newMatch);
});

app.get("/matches", (req: Request, res: Response) => {
    return res.json(matches);
});

app.get("/matches/:id", (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const match = matches.find((m) => m.matchId === id);
    if (!match) {
        return res.status(404).json({ error: "Match not found" });
    }
    return res.json(match);
});

io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    socket.emit("allMatches", matches);

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
    });
});

setInterval(() => {
    simulateKill(io);
}, Math.floor(Math.random() * 9000) + 1000);

const PORT = 4000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
