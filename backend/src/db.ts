import sql from "mssql";
import { config } from "./config.js";

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool({
      server: config.sql.server,
      port: config.sql.port,
      database: config.sql.database,
      user: config.sql.user,
      password: config.sql.password,
      options: config.sql.options,
      pool: config.sql.pool,
    })
      .connect()
      .then((pool) => {
        console.log(
          `[db] connected to ${config.sql.server}:${config.sql.port}/${config.sql.database}`,
        );
        pool.on("error", (err) => console.error("[db] pool error:", err));
        return pool;
      })
      .catch((err) => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

export async function withRequest<T>(
  fn: (req: sql.Request) => Promise<T>,
): Promise<T> {
  const pool = await getPool();
  return fn(pool.request());
}

export async function withTransaction<T>(
  fn: (tx: sql.Transaction) => Promise<T>,
): Promise<T> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try { await tx.rollback(); } catch { /* ignore */ }
    throw err;
  }
}

export { sql };
