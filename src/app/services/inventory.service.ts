import { Injectable } from '@angular/core';
import { save } from '@tauri-apps/plugin-dialog';
import { copyFile, mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';

export interface InventoryItem {
  id?: number;
  name: string;
  image_path?: string;
  cantidad_necesaria: number;
  cantidad_disponible: number;
  created_at?: string;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__: any;
  }
}

@Injectable({
  providedIn: 'root'
})
export class InventoryService {
  private async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  }

  async getAllItems(): Promise<InventoryItem[]> {
    return await this.invoke<InventoryItem[]>('get_all_items');
  }

  async addItem(name: string, cantidadNecesaria: number, cantidadDisponible: number, imageBase64?: string): Promise<InventoryItem> {
    return await this.invoke<InventoryItem>('add_item', {
      name,
      imageBase64,
      cantidadNecesaria,
      cantidadDisponible
    });
  }

  async updateItem(id: number, name: string, cantidadNecesaria: number, cantidadDisponible: number, imageBase64?: string): Promise<InventoryItem> {
    return await this.invoke<InventoryItem>('update_item', {
      id,
      name,
      imageBase64,
      cantidadNecesaria,
      cantidadDisponible
    });
  }

  async deleteItem(id: number): Promise<void> {
    await this.invoke<void>('delete_item', { id });
  }

async exportDatabase() {
  try {
    console.log('A. Iniciando save dialog...');
    
    // 1. Pedir al usuario dónde guardar
    const { downloadDir } = await import('@tauri-apps/api/path');
    const defaultDownloadPath = await downloadDir();
    
    const exportPath = await save({
      defaultPath: `${defaultDownloadPath}inventario_backup_${new Date().toISOString().split('T')[0]}.db`,
      filters: [{
        name: 'Base de datos SQLite',
        extensions: ['db']
      }]
    });

    console.log('B. Export path seleccionado:', exportPath);

    if (!exportPath) {
      throw new Error('Exportación cancelada');
    }

    // 2. Obtener la ruta de la base de datos desde Rust
    console.log('C. Obteniendo ruta de DB...');
    const dbPath = await this.invoke<string>('get_db_path');
    console.log('D. Ruta DB:', dbPath);

    // 3. Copiar el archivo .db
    console.log('E. Copiando archivo DB...');
    await copyFile(dbPath, exportPath);
    console.log('F. Archivo DB copiado exitosamente');

    // 4. Crear carpeta de imágenes EN LA MISMA ubicación que el .db exportado
    const exportFolder = exportPath.substring(0, exportPath.lastIndexOf('\\'));
    const imagesFolder = `${exportFolder}\\imagenes_inventario`;
    
    console.log('G. Carpeta de imágenes:', imagesFolder);
    console.log('H. Obteniendo items...');
    
    const items = await this.getAllItems();
    console.log('I. Items obtenidos:', items.length);
    
    const itemsWithImages = items.filter(item => item.image_path);
    console.log('J. Items con imágenes:', itemsWithImages.length);
    
    if (itemsWithImages.length > 0) {
      console.log('K. Creando carpeta de imágenes...');
      await mkdir(imagesFolder, { recursive: true });
      
      for (const item of itemsWithImages) {
        if (item.image_path) {
          try {
            const imageName = item.image_path.split(/[\\/]/).pop() || '';
            console.log('L. Copiando imagen:', imageName);
            await copyFile(item.image_path, `${imagesFolder}\\${imageName}`);
          } catch (e) {
            console.warn('No se pudo copiar imagen:', item.image_path, e);
          }
        }
      }
    }

    console.log('M. Exportación completada');
    return {
      dbPath: exportPath,
      imagesPath: itemsWithImages.length > 0 ? imagesFolder : 'Sin imágenes'
    };
  } catch (error) {
    console.error('Error exportando base de datos:', error);
    throw error;
  }
}

async importDatabase() {
  try {
    console.log('A. Abriendo diálogo para seleccionar archivo...');
    
    const { open } = await import('@tauri-apps/plugin-dialog');
    
    const selectedFile = await open({
      multiple: false,
      filters: [{
        name: 'Base de datos SQLite',
        extensions: ['db']
      }]
    });

    if (!selectedFile) {
      throw new Error('Importación cancelada');
    }

    console.log('B. Archivo seleccionado:', selectedFile);

    const currentDbPath = await this.invoke<string>('get_db_path');
    console.log('C. Ruta DB actual:', currentDbPath);

    console.log('D. Sobrescribiendo base de datos...');
    await copyFile(selectedFile as string, currentDbPath);
    console.log('E. Base de datos importada exitosamente');

    const pathSeparator = (selectedFile as string).includes('\\') ? '\\' : '/';
    const importFolder = (selectedFile as string).substring(0, (selectedFile as string).lastIndexOf(pathSeparator));
    const imagesFolder = `${importFolder}${pathSeparator}imagenes_inventario`;
    
    console.log('F. Buscando carpeta de imágenes en:', imagesFolder);

    const { exists, readDir } = await import('@tauri-apps/plugin-fs');
    const { appDataDir } = await import('@tauri-apps/api/path');
    
    let imagesImported = 0;
    
    try {
      const imagesFolderExists = await exists(imagesFolder);
      
      if (imagesFolderExists) {
        console.log('G. Carpeta de imágenes encontrada');
        
        const appData = await appDataDir();
        const targetImagesFolder = `${appData}${pathSeparator}inventory_images`;
        
        await mkdir(targetImagesFolder, { recursive: true });
        
        const entries = await readDir(imagesFolder);
        console.log('H. Imágenes encontradas:', entries.length);
        
        for (const entry of entries) {
          if (entry.isFile) {
            try {
              const sourcePath = `${imagesFolder}${pathSeparator}${entry.name}`;
              const targetPath = `${targetImagesFolder}${pathSeparator}${entry.name}`;
              await copyFile(sourcePath, targetPath);
              imagesImported++;
            } catch (e) {
              console.warn('No se pudo copiar imagen:', entry.name, e);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error al importar imágenes:', e);
    }

    // NUEVO: Arreglar rutas de imágenes después de importar
    console.log('I. Arreglando rutas de imágenes...');
    const pathsFixed = await this.invoke<number>('fix_image_paths');
    console.log('J. Rutas actualizadas:', pathsFixed);

    return {
      success: true,
      imagesImported: imagesImported,
      message: imagesImported > 0 
        ? `Base de datos importada con ${imagesImported} imagen(es). ${pathsFixed} rutas actualizadas.` 
        : 'Base de datos importada sin imágenes'
    };
    
  } catch (error) {
    console.error('Error importando base de datos:', error);
    throw error;
  }
}
}