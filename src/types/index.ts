
export interface Player {
    id: string;
    name: string;
    kills: number;
    deaths: number;
    assists: number;
    dead: boolean;
    weaponId: number;
    moneyCount: number;
    headshots: number;
}

export interface Team {
    name: string;
    side: "CT" | "TT";
    winRounds: number;
    players: Player[];
}


export interface Match {
    matchId: string;
    mapId: number;
    timer: number;
    round: number;
    roundsHistory: number[];
    mode: number;
    team1: Team;
    team2: Team;
    killFeed: KillEvent[];
    finished?: boolean;
}

export interface CreateMatchParams {
    mapId: number;
    team1: {
        name: string;
        players: string[];
    }
    team2: {
        name: string;
        players: string[];
    }
    teamPlayersCount: number;
}

export interface KillEvent {
    killerId: string;
    victimId: string;
    weaponId: number;
    timestamp: number;
    headshot?: boolean;
    assistId?: string;
}

export interface Weapon {
    id: number;
    name: string;
}

export interface Map {
    id: number;
    name: string;
}