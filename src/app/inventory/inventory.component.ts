import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService, InventoryItem } from '../services/inventory.service';

interface InventoryItemWithUrl extends InventoryItem {
  imageUrl?: string;
}

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inventory.component.html',
  styleUrls: ['./inventory.component.css']
})
export class InventoryComponent implements OnInit {
  items: InventoryItemWithUrl[] = [];
  filteredItems: InventoryItemWithUrl[] = [];
  searchTerm: string = '';
  sortBy: 'none' | 'disponible_asc' | 'disponible_desc' | 'nombre_asc' | 'nombre_desc' = 'none';
  isModalOpen = false;
  isEditMode = false;
  currentItem: InventoryItem = { name: '', cantidad_necesaria: 0, cantidad_disponible: 0 };
  selectedImage: string | null = null;
  isLoading = false;
  isDeleteConfirmOpen = false;
  itemToDelete: InventoryItem | null = null;
  viewMode: 'grid' | 'table' = 'grid';

  constructor(private inventoryService: InventoryService) {}

  async ngOnInit() {
    await this.loadItems();
  }

  async loadItems() {
    try {
      this.isLoading = true;
      const rawItems = await this.inventoryService.getAllItems();

      // Convertir las rutas de imágenes a URLs utilizables
      this.items = await Promise.all(
        rawItems.map(async (item) => {
          const itemWithUrl: InventoryItemWithUrl = { ...item };
          if (item.image_path) {
            itemWithUrl.imageUrl = await this.convertImagePath(item.image_path);
          }
          return itemWithUrl;
        })
      );
      this.filterItems();
    } catch (error) {
      console.error('Error loading items:', error);
      alert('Error al cargar los artículos');
    } finally {
      this.isLoading = false;
    }
  }

async convertImagePath(imagePath: string): Promise<string> {
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    
    // Verificar si el archivo existe antes de convertir
    const { exists } = await import('@tauri-apps/plugin-fs');
    const fileExists = await exists(imagePath);
    
    if (!fileExists) {
      console.warn('Imagen no encontrada:', imagePath);
      return '';
    }
    
    const convertedUrl = convertFileSrc(imagePath);
    console.log('Original path:', imagePath);
    console.log('Converted URL:', convertedUrl);
    return convertedUrl;
  } catch (error) {
    console.error('Error converting file path:', error);
    return '';
  }
}

  openAddModal() {
    this.isEditMode = false;
    this.currentItem = { name: '', cantidad_necesaria: 0, cantidad_disponible: 0 };
    this.selectedImage = null;
    this.isModalOpen = true;
  }

  openEditModal(item: InventoryItem) {
    this.isEditMode = true;
    this.currentItem = { ...item };
    this.selectedImage = null;
    this.isModalOpen = true;
  }

  closeModal() {
    this.isModalOpen = false;
    this.currentItem = { name: '', cantidad_necesaria: 0, cantidad_disponible: 0 };
    this.selectedImage = null;
  }

  async onFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.selectedImage = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  }

  async saveItem() {
    if (!this.currentItem.name.trim()) {
      alert('Por favor ingresa un nombre para el artículo');
      return;
    }

    try {
      this.isLoading = true;

      if (this.isEditMode && this.currentItem.id) {
        await this.inventoryService.updateItem(
          this.currentItem.id,
          this.currentItem.name,
          this.currentItem.cantidad_necesaria,
          this.currentItem.cantidad_disponible,
          this.selectedImage || undefined
        );
      } else {
        await this.inventoryService.addItem(
          this.currentItem.name,
          this.currentItem.cantidad_necesaria,
          this.currentItem.cantidad_disponible,
          this.selectedImage || undefined
        );
      }

      await this.loadItems();
      this.closeModal();
    } catch (error) {
      console.error('Error saving item:', error);
      alert('Error al guardar el artículo');
    } finally {
      this.isLoading = false;
    }
  }

  openDeleteConfirm(event: Event, item: InventoryItem) {
    event.preventDefault();
    event.stopPropagation();
    this.itemToDelete = item;
    this.isDeleteConfirmOpen = true;
  }

  closeDeleteConfirm() {
    this.isDeleteConfirmOpen = false;
    this.itemToDelete = null;
  }

  async confirmDelete() {
    if (!this.itemToDelete || !this.itemToDelete.id) {
      this.closeDeleteConfirm();
      return;
    }

    try {
      this.isLoading = true;
      await this.inventoryService.deleteItem(this.itemToDelete.id);
      await this.loadItems();
      this.closeDeleteConfirm();
    } catch (error) {
      console.error('Error deleting item:', error);
      alert('Error al eliminar el artículo');
    } finally {
      this.isLoading = false;
    }
  }

async exportData() {
  try {
    this.isLoading = true;
    console.log('1. Iniciando exportación...');
    
    const result = await this.inventoryService.exportDatabase();
    
    console.log('2. Exportación exitosa:', result);
    alert(`Base de datos exportada exitosamente en: ${result.dbPath}\nImágenes en: ${result.imagesPath}`);
  } catch (error: any) {
    console.error('Error completo:', error);
    
    // Mostrar el error específico
    let errorMessage = 'Error desconocido';
    if (error?.message) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    
    alert(`Error al exportar la base de datos:\n${errorMessage}`);
  } finally {
    this.isLoading = false;
  }
}

async importData() {
  try {
    this.isLoading = true;
    const result = await this.inventoryService.importDatabase();
    
    alert(`✅ ${result.message}`);
    
    // Recargar los items para mostrar los datos importados
    await this.loadItems();
    
  } catch (error: any) {
    console.error('Error importing database:', error);
    
    let errorMessage = 'Error desconocido';
    if (error?.message) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    
    alert(`❌ Error al importar la base de datos:\n${errorMessage}`);
  } finally {
    this.isLoading = false;
  }
}

  toggleViewMode() {
    this.viewMode = this.viewMode === 'grid' ? 'table' : 'grid';
  }

 filterItems() {
  // Primero filtramos por búsqueda
  let result: InventoryItemWithUrl[];
  if (!this.searchTerm.trim()) {
    result = [...this.items];
  } else {
    const search = this.searchTerm.toLowerCase();
    result = this.items.filter(item =>
      item.name.toLowerCase().includes(search)
    );
  }

  // Luego ordenamos según la opción seleccionada
  if (this.sortBy === 'disponible_asc') {
    result.sort((a, b) => a.cantidad_disponible - b.cantidad_disponible);
  } else if (this.sortBy === 'disponible_desc') {
    result.sort((a, b) => b.cantidad_disponible - a.cantidad_disponible);
  } else if (this.sortBy === 'nombre_asc') {
    result.sort((a, b) => a.name.localeCompare(b.name));
  } else if (this.sortBy === 'nombre_desc') {
    result.sort((a, b) => b.name.localeCompare(a.name));
  }

  this.filteredItems = result;
}

  onSearchChange() {
    this.filterItems();
  }

  onSortChange() {
    this.filterItems();
  }
}
