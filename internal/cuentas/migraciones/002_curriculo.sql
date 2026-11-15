-- integrador5: «Alineado al CNB de Guatemala» (marcado por defecto al crear la cuenta). general = mismo contenido sin referencias CNB.
ALTER TABLE usuarios ADD COLUMN curriculo TEXT NOT NULL DEFAULT 'cnb';
