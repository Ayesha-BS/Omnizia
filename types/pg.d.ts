declare module 'pg' {
    import { EventEmitter } from 'events';

    export interface ClientConfig {
        host?: string;
        port?: number;
        user?: string;
        password?: string;
        database?: string;
        ssl?: {
            rejectUnauthorized?: boolean;
        };
        connectionTimeoutMillis?: number;
        query_timeout?: number;
    }

    export interface QueryResult<T = any> {
        rows: T[];
        rowCount: number;
        command: string;
        oid: number;
        fields: FieldDef[];
    }

    export interface FieldDef {
        name: string;
        tableID: number;
        columnID: number;
        dataTypeID: number;
        dataTypeSize: number;
        dataTypeModifier: number;
        format: string;
    }

    export class Client extends EventEmitter {
        constructor(config?: ClientConfig);
        connect(): Promise<void>;
        end(): Promise<void>;
        query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>>;
        query(text: string, params: any[], callback: (err: Error, result: QueryResult) => void): void;
        query(text: string, callback: (err: Error, result: QueryResult) => void): void;
    }
}
