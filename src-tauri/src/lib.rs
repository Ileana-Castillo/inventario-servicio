use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InventoryItem {
    pub id: Option<i64>,
    pub name: String,
    pub image_path: Option<String>,
    pub cantidad_necesaria: i32,
    pub cantidad_disponible: i32,
    pub created_at: Option<String>,
}

pub struct AppState {
    db: Mutex<Connection>,
    app_handle: AppHandle,
}

fn get_app_data_dir(app_handle: &AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory")
}

fn init_database(app_handle: &AppHandle) -> Result<Connection> {
    let mut db_path = get_app_data_dir(app_handle);
    fs::create_dir_all(&db_path).expect("Failed to create app data directory");
    db_path.push("inventario.db");

    let conn = Connection::open(db_path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            image_path TEXT,
            cantidad_necesaria INTEGER NOT NULL DEFAULT 0,
            cantidad_disponible INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )",
        [],
    )?;

    // Agregar columnas si la tabla ya existe pero no tiene estos campos
    let _ = conn.execute("ALTER TABLE inventory ADD COLUMN cantidad_necesaria INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE inventory ADD COLUMN cantidad_disponible INTEGER NOT NULL DEFAULT 0", []);

    Ok(conn)
}

#[tauri::command]
fn get_all_items(state: State<AppState>) -> Result<Vec<InventoryItem>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, name, image_path, cantidad_necesaria, cantidad_disponible, created_at FROM inventory ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], |row| {
            Ok(InventoryItem {
                id: row.get(0)?,
                name: row.get(1)?,
                image_path: row.get(2)?,
                cantidad_necesaria: row.get(3)?,
                cantidad_disponible: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
fn add_item(
    name: String,
    image_base64: Option<String>,
    cantidad_necesaria: i32,
    cantidad_disponible: i32,
    state: State<AppState>
) -> Result<InventoryItem, String> {
    let mut image_path = None;

    if let Some(base64_data) = image_base64 {
        image_path = Some(save_image(&base64_data, &state.app_handle)?);
    }

    // Obtener fecha y hora local
    let local_time = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO inventory (name, image_path, cantidad_necesaria, cantidad_disponible, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![name, image_path, cantidad_necesaria, cantidad_disponible, local_time],
    )
    .map_err(|e| e.to_string())?;

    let id = db.last_insert_rowid();

    let mut stmt = db
        .prepare("SELECT id, name, image_path, cantidad_necesaria, cantidad_disponible, created_at FROM inventory WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let item = stmt
        .query_row([id], |row| {
            Ok(InventoryItem {
                id: row.get(0)?,
                name: row.get(1)?,
                image_path: row.get(2)?,
                cantidad_necesaria: row.get(3)?,
                cantidad_disponible: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(item)
}

#[tauri::command]
fn update_item(
    id: i64,
    name: String,
    image_base64: Option<String>,
    cantidad_necesaria: i32,
    cantidad_disponible: i32,
    state: State<AppState>,
) -> Result<InventoryItem, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let mut image_path: Option<String> = None;

    if let Some(base64_data) = image_base64 {
        // Eliminar imagen anterior si existe
        let mut stmt = db
            .prepare("SELECT image_path FROM inventory WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        if let Ok(old_path) = stmt.query_row([id], |row| row.get::<_, Option<String>>(0)) {
            if let Some(path) = old_path {
                let _ = fs::remove_file(&path);
            }
        }

        image_path = Some(save_image(&base64_data, &state.app_handle)?);
    }

    if image_path.is_some() {
        db.execute(
            "UPDATE inventory SET name = ?1, image_path = ?2, cantidad_necesaria = ?3, cantidad_disponible = ?4 WHERE id = ?5",
            params![name, image_path, cantidad_necesaria, cantidad_disponible, id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        db.execute(
            "UPDATE inventory SET name = ?1, cantidad_necesaria = ?2, cantidad_disponible = ?3 WHERE id = ?4",
            params![name, cantidad_necesaria, cantidad_disponible, id],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut stmt = db
        .prepare("SELECT id, name, image_path, cantidad_necesaria, cantidad_disponible, created_at FROM inventory WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let item = stmt
        .query_row([id], |row| {
            Ok(InventoryItem {
                id: row.get(0)?,
                name: row.get(1)?,
                image_path: row.get(2)?,
                cantidad_necesaria: row.get(3)?,
                cantidad_disponible: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(item)
}

#[tauri::command]
fn delete_item(id: i64, state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Eliminar imagen si existe
    let mut stmt = db
        .prepare("SELECT image_path FROM inventory WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    if let Ok(image_path) = stmt.query_row([id], |row| row.get::<_, Option<String>>(0)) {
        if let Some(path) = image_path {
            let _ = fs::remove_file(&path);
        }
    }

    db.execute("DELETE FROM inventory WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_db_path(state: State<AppState>) -> Result<String, String> {
    let mut db_path = get_app_data_dir(&state.app_handle);
    db_path.push("inventario.db");
    
    Ok(db_path.to_string_lossy().to_string())
}

#[tauri::command]
fn fix_image_paths(state: State<AppState>) -> Result<i32, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    
    // Obtener la nueva ruta de imágenes
    let mut new_images_dir = get_app_data_dir(&state.app_handle);
    new_images_dir.push("inventory_images");
    
    // Obtener todos los items con imágenes
    let mut stmt = db
        .prepare("SELECT id, image_path FROM inventory WHERE image_path IS NOT NULL")
        .map_err(|e| e.to_string())?;
    
    let items: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    
    let mut updated = 0;
    
    for (id, old_path) in items {
        // Extraer solo el nombre del archivo
        if let Some(filename) = std::path::Path::new(&old_path).file_name() {
            let mut new_path = new_images_dir.clone();
            new_path.push(filename);
            
            // Verificar si el archivo existe en la nueva ubicación
            if new_path.exists() {
                db.execute(
                    "UPDATE inventory SET image_path = ?1 WHERE id = ?2",
                    params![new_path.to_string_lossy().to_string(), id],
                )
                .map_err(|e| e.to_string())?;
                updated += 1;
            }
        }
    }
    
    Ok(updated)
}

fn save_image(base64_data: &str, app_handle: &AppHandle) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};

    let image_data = if base64_data.contains("base64,") {
        let parts: Vec<&str> = base64_data.split("base64,").collect();
        general_purpose::STANDARD.decode(parts[1]).map_err(|e| e.to_string())?
    } else {
        general_purpose::STANDARD.decode(base64_data).map_err(|e| e.to_string())?
    };

    let mut images_dir = get_app_data_dir(app_handle);
    images_dir.push("inventory_images");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let filename = format!("img_{}.png", chrono::Utc::now().timestamp_millis());
    let mut image_path = images_dir.clone();
    image_path.push(&filename);

    fs::write(&image_path, image_data).map_err(|e| e.to_string())?;

    Ok(image_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let conn = init_database(&app_handle).expect("Failed to initialize database");

            app.manage(AppState {
                db: Mutex::new(conn),
                app_handle,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_all_items,
            add_item,
            update_item,
            delete_item,
            get_db_path,
            fix_image_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}