-- ============================================================================
-- Cloudflare D1 SQL Schema for Poultry Weight Tracker
-- Serverless SQLite Database with 15 GB+ capacity (multi-shard / D1 + R2 store)
-- ============================================================================

-- 1. Users Table (Role-based access: ADMIN, MANAGER, SUPERVISOR, INCHARGE)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone_or_email TEXT UNIQUE NOT NULL,
    role TEXT CHECK(role IN ('ADMIN', 'MANAGER', 'SUPERVISOR', 'INCHARGE')) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Standard Reference Weights by Gender and Week/Day
CREATE TABLE IF NOT EXISTS standard_weights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flock_age_days INTEGER NOT NULL,
    age_week INTEGER NOT NULL,
    gender TEXT CHECK(gender IN ('MALE', 'FEMALE')) NOT NULL,
    std_weight_grams REAL NOT NULL,
    tolerance_grams REAL DEFAULT 25,
    UNIQUE(flock_age_days, gender)
);

-- 3. Farms Table
CREATE TABLE IF NOT EXISTS farms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT,
    flock_age_days INTEGER NOT NULL DEFAULT 7,
    age_week TEXT DEFAULT 'W1',
    season TEXT CHECK(season IN ('Summer', 'Winter')) DEFAULT 'Summer',
    flock_date TEXT,
    is_archived INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3b. Batches Table (Farm -> Batch -> Week Hierarchy)
CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL,
    batch_name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    start_week_number INTEGER NOT NULL DEFAULT 1,
    status TEXT CHECK(status IN ('ACTIVE', 'COMPLETED')) NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE
);

-- 4. Sheds Table (NO Gender column here; Gender is strictly at the Line level)
CREATE TABLE IF NOT EXISTS sheds (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL,
    name TEXT NOT NULL,
    target_bird_count INTEGER DEFAULT 0,
    locked_by_user_id TEXT,
    locked_by_user_name TEXT,
    locked_at DATETIME,
    last_heartbeat_at DATETIME,
    recorded_by_user_id TEXT,
    recorded_by_user_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE
);

-- 5. Parts Table
CREATE TABLE IF NOT EXISTS parts (
    id TEXT PRIMARY KEY,
    shed_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shed_id) REFERENCES sheds(id) ON DELETE CASCADE
);

-- 6. Lines Table (Gender is stored per Line: MALE or FEMALE)
CREATE TABLE IF NOT EXISTS lines (
    id TEXT PRIMARY KEY,
    part_id TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    gender TEXT CHECK(gender IN ('MALE', 'FEMALE')) NOT NULL DEFAULT 'MALE',
    std_weight_grams REAL NOT NULL DEFAULT 140,
    target_bird_count INTEGER DEFAULT 50,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE
);

-- 7. Individual Bird Weights Table
CREATE TABLE IF NOT EXISTS bird_weights (
    id TEXT PRIMARY KEY,
    line_id TEXT NOT NULL,
    entry_index INTEGER NOT NULL,
    weight_grams REAL NOT NULL,
    std_weight_at_entry REAL NOT NULL,
    recorded_by TEXT,
    week TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (line_id) REFERENCES lines(id) ON DELETE CASCADE
);

-- 8. Submissions & Reports Table (Linked to R2 15 GB+ Object Storage)
CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL,
    flock_age TEXT NOT NULL,
    season TEXT,
    total_birds INTEGER DEFAULT 0,
    submitted_by TEXT NOT NULL,
    submitted_role TEXT,
    r2_report_key TEXT,
    data_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE
);

-- 9. Activity Logs Table
CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    shed_name TEXT,
    part_name TEXT,
    line_name TEXT,
    sample_count INTEGER DEFAULT 0,
    avg_weight REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. Shed Week Status Table (Tracks shed save status per week without polluting global submission history)
CREATE TABLE IF NOT EXISTS shed_week_status (
    shed_id TEXT NOT NULL,
    farm_id TEXT NOT NULL,
    week TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SAVED',
    saved_by_user_id TEXT,
    saved_by_user_name TEXT,
    total_bird_count INTEGER DEFAULT 0,
    saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (shed_id, week),
    FOREIGN KEY (shed_id) REFERENCES sheds(id) ON DELETE CASCADE
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_weights_line ON bird_weights(line_id);
CREATE INDEX IF NOT EXISTS idx_lines_part ON lines(part_id);
CREATE INDEX IF NOT EXISTS idx_parts_shed ON parts(shed_id);
CREATE INDEX IF NOT EXISTS idx_sheds_farm ON sheds(farm_id);
CREATE INDEX IF NOT EXISTS idx_submissions_farm ON submissions(farm_id);
CREATE INDEX IF NOT EXISTS idx_std_weights_lookup ON standard_weights(age_week, gender);
CREATE INDEX IF NOT EXISTS idx_shed_week_status ON shed_week_status(farm_id, week);

-- ============================================================================
-- Seed Initial Suguna Reference Standard Weights (Weeks 1 to 24)
-- ============================================================================
INSERT OR IGNORE INTO standard_weights (flock_age_days, age_week, gender, std_weight_grams, tolerance_grams) VALUES
(7, 1, 'FEMALE', 140, 25),
(7, 1, 'MALE', 150, 25),
(14, 2, 'FEMALE', 280, 25),
(14, 2, 'MALE', 310, 25),
(21, 3, 'FEMALE', 450, 25),
(21, 3, 'MALE', 500, 25),
(28, 4, 'FEMALE', 630, 50),
(28, 4, 'MALE', 720, 50),
(35, 5, 'FEMALE', 810, 50),
(35, 5, 'MALE', 940, 50),
(42, 6, 'FEMALE', 990, 50),
(42, 6, 'MALE', 1160, 50),
(49, 7, 'FEMALE', 1150, 50),
(49, 7, 'MALE', 1370, 50),
(56, 8, 'FEMALE', 1300, 50),
(56, 8, 'MALE', 1570, 50),
(63, 9, 'FEMALE', 1430, 75),
(63, 9, 'MALE', 1750, 75),
(70, 10, 'FEMALE', 1540, 75),
(70, 10, 'MALE', 1900, 75),
(77, 11, 'FEMALE', 1630, 75),
(77, 11, 'MALE', 2030, 75),
(84, 12, 'FEMALE', 1710, 75),
(84, 12, 'MALE', 2140, 75),
(91, 13, 'FEMALE', 1780, 75),
(91, 13, 'MALE', 2240, 75),
(98, 14, 'FEMALE', 1840, 75),
(98, 14, 'MALE', 2330, 75),
(105, 15, 'FEMALE', 1900, 100),
(105, 15, 'MALE', 2420, 100),
(112, 16, 'FEMALE', 1960, 100),
(112, 16, 'MALE', 2510, 100),
(119, 17, 'FEMALE', 2020, 100),
(119, 17, 'MALE', 2600, 100),
(126, 18, 'FEMALE', 2090, 100),
(126, 18, 'MALE', 2700, 100),
(133, 19, 'FEMALE', 2170, 100),
(133, 19, 'MALE', 2810, 100),
(140, 20, 'FEMALE', 2260, 100),
(140, 20, 'MALE', 2930, 100),
(147, 21, 'FEMALE', 2360, 100),
(147, 21, 'MALE', 3060, 100),
(154, 22, 'FEMALE', 2470, 100),
(154, 22, 'MALE', 3200, 100),
(161, 23, 'FEMALE', 2590, 100),
(161, 23, 'MALE', 3350, 100),
(168, 24, 'FEMALE', 2720, 100),
(168, 24, 'MALE', 3510, 100);

-- Default Master, Manager & Field Operators Seed
INSERT OR IGNORE INTO users (id, name, phone_or_email, role) VALUES
('user-master-shreedhar', 'Shreedhar', 'shreedhar', 'MANAGER'),
('user-admin-1', 'Operations Director', 'admin@poultry.internal', 'MANAGER'),
('user-mgr-1', 'Regional Farm Manager', 'manager@poultry.internal', 'MANAGER'),
('user-sup-1', 'Field Supervisor', 'supervisor@poultry.internal', 'SUPERVISOR'),
('user-inc-1', 'Line In-Charge', 'incharge@poultry.internal', 'INCHARGE');
