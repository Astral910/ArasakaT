-- Cuentas y terrenos guardados (ronda 5).
CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  correo TEXT UNIQUE,
  telefono TEXT UNIQUE,
  whatsapp TEXT UNIQUE,
  nombre TEXT NOT NULL DEFAULT '',
  idioma TEXT NOT NULL DEFAULT 'es',
  hash TEXT NOT NULL,
  creado TEXT NOT NULL,
  actualizado TEXT NOT NULL
);
CREATE TABLE sesiones_web (
  token_hash TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  creado TEXT NOT NULL,
  expira TEXT NOT NULL
);
CREATE INDEX sesiones_web_usuario ON sesiones_web(usuario_id);
CREATE TABLE parcelas (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  forma TEXT NOT NULL DEFAULT 'punto',
  radio REAL,
  poly TEXT,
  cultivo TEXT NOT NULL DEFAULT '',
  area_m2 REAL,
  siembra TEXT,
  riego TEXT NOT NULL DEFAULT '',
  notas TEXT NOT NULL DEFAULT '',
  creado TEXT NOT NULL,
  actualizado TEXT NOT NULL
);
CREATE INDEX parcelas_usuario ON parcelas(usuario_id, creado);
-- Códigos de 6 dígitos (recuperar contraseña, vincular WhatsApp). Se guarda solo el hash.
CREATE TABLE codigos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  destino TEXT NOT NULL DEFAULT '',
  codigo_hash TEXT NOT NULL,
  intentos INTEGER NOT NULL DEFAULT 0,
  usado INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL,
  expira TEXT NOT NULL
);
CREATE INDEX codigos_usuario ON codigos(usuario_id, tipo, creado);
