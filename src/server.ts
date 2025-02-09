import express, { Application, Request, Response } from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";

import {CreateMatchParams, KillEvent, Match, Player, Team} from "./types";
import { MAPS } from "./consts/maps";
import { WEAPONS } from "./consts/weapons";

let matches: Match[] = [];
let finishedMatches: Match[] = [];

function getRandomWeaponId(): number {
    const weaponKeys = Object.keys(WEAPONS);
    const randomIndex = Math.floor(Math.random() * weaponKeys.length);
    return Number(weaponKeys[randomIndex]);
}

function createPlayers(playerNames: string[], teamPlayersCount: number): Player[] {
    const limitedNames = playerNames.slice(0, teamPlayersCount);

    return limitedNames.map<Player>((name) => {
        return {
            id: uuidv4(),
            name,
            kills: 0,
            deaths: 0,
            assists: 0,
            dead: false,
            weaponId: getRandomWeaponId(),
            moneyCount: 800,
            headshots: 0,
        };
    });
}

function createMatch(params: CreateMatchParams): Match {
    const { mapId, team1, team2, teamPlayersCount } = params;

    const foundMap = MAPS[mapId] || MAPS[1];

    const match: Match = {
        matchId: uuidv4(),
        mapId: foundMap.id,
        timer: 90,
        round: 1,
        roundsHistory: [],
        mode: teamPlayersCount,
        team1: {
            name: team1.name,
            side: "CT",
            winRounds: 0,
            players: createPlayers(team1.players, teamPlayersCount),
        },
        team2: {
            name: team2.name,
            side: "TT",
            winRounds: 0,
            players: createPlayers(team2.players, teamPlayersCount),
        },
        killFeed: [],
        finished: false,
        currentRoundKillEvents: []
    };

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

            match.roundsHistory.push({
                round: match.round,
                team1WinRounds: match.team1.winRounds,
                team2WinRounds: match.team2.winRounds,
                team1Win: winningTeam === match.team1,
                killEvents: match.currentRoundKillEvents
            });
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

        io.emit("matchUpdate", match);

        const maxRounds = 24;
        const team1Wins = match.team1.winRounds;
        const team2Wins = match.team2.winRounds;

        if (team1Wins === 13 || team2Wins === 13 || match.round > maxRounds) {
            finishMatch(match, io);
        }

        match.currentRoundKillEvents = [];
    }
}

function finishMatch(match: Match, io: SocketIOServer) {
    match.finished = true;
    io.emit("matchUpdate", match);

    matches = matches.filter((m) => m.matchId !== match.matchId);
    finishedMatches.push(match);

    io.emit("matchFinished", match);
}

function simulateKill(io: SocketIOServer) {
    const ongoingMatches = matches.filter((m) => !m.finished);
    if (ongoingMatches.length === 0) return;

    const randomMatchIndex = Math.floor(Math.random() * ongoingMatches.length);
    const match = ongoingMatches[randomMatchIndex];
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
    const killer = alivePlayers[killerIndex];

    const killerInTeam1 = match.team1.players.some((p) => p.id === killer.id);

    const teamKill = Math.random() < 0.05;

    let potentialVictims: Player[];
    if (teamKill) {
        potentialVictims = killerInTeam1
            ? match.team1.players.filter((p) => !p.dead && p.id !== killer.id)
            : match.team2.players.filter((p) => !p.dead && p.id !== killer.id);
    } else {
        potentialVictims = killerInTeam1
            ? match.team2.players.filter((p) => !p.dead)
            : match.team1.players.filter((p) => !p.dead);
    }

    if (potentialVictims.length === 0) {
        checkRoundEnd(match, io);
        return;

    }

    const victimIndex = Math.floor(Math.random() * potentialVictims.length);
    const victim = potentialVictims[victimIndex];

    killer.kills += 1;
    victim.deaths += 1;
    victim.dead = true;

    const isHeadshot = Math.random() < 0.4;
    if (isHeadshot) {
        killer.headshots += 1;
    }

    let assistId: string | undefined;
    if (Math.random() < 0.4) {
        const teammates = killerInTeam1
            ? match.team1.players.filter((p) => p.id !== killer.id && !p.dead)
            : match.team2.players.filter((p) => p.id !== killer.id && !p.dead);

        if (teammates.length > 0) {
            const mateIndex = Math.floor(Math.random() * teammates.length);
            const mate = teammates[mateIndex];
            mate.assists += 1;
            assistId = mate.id;
        }
    }

    const killEvent: KillEvent = {
        killerName: killer.name,
        killerSide: killerInTeam1 ? match.team1.side : match.team2.side,
        victimName: victim.name,
        victimSide: killerInTeam1 ? match.team2.side : match.team1.side,
        weaponId: killer.weaponId,
        timestamp: Date.now(),
        headshot: isHeadshot,
        assistId,
    };
    match.killFeed.push(killEvent);
    if (match.killFeed.length > 15) {
        match.killFeed.shift();
    }

    match.currentRoundKillEvents.push(killEvent);

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

app.get("/matches/finished", (req: Request, res: Response) => {
    return res.json(finishedMatches);
});

app.get("/matches/:id", (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    const match = matches.find((m) => m.matchId === id);
    if (!match) {
        const finished = finishedMatches.find((fm) => fm.matchId === id);
        if (!finished) {
            return res.status(404).json({ error: "Match not found" });
        }
        return res.json(finished);
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
