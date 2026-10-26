import { InspectionData } from '../types/inspection';
import { SAMPLE_INSPECTION_DATA } from '../data/sampleInspection';

const DB_NAME = 'AnexoTecnicoVialDB_v2';
const DB_VERSION = 1;
const STORE_NAME = 'inspecciones';
const LS_FALLBACK_KEY = 'anexo_tecnico_inspecciones_backup_v2';

export const OFFICIAL_INSTITUTIONAL_DATA = {
  dependencia: "GOBIERNO DEL ESTADO DE CAMPECHE",
  direccionUnidad: "Dirección de Transito y Vialidad",
  domicilio: "Av. Héroes de la salud # 385 por av maestros campechanos y prolongación lázaro cárdenas col. multunchac",
  telefono: "9818119110 ext 80050",
  paginaWeb: "https://www.spsc.campeche.gob.mx/",
  nombreCompleto: "Pablo Ernesto Garrido Vera",
  cargo: "Encargado Balizamiento y Semaforizacion",
  areaAdministrativa: "Dirección de Transito y Vialidad",
};

/**
 * Ensures that any loaded inspection has the official institutional information
 * and current officer defaults applied.
 */
export function enforceOfficialInstitutionalData(item: InspectionData): InspectionData {
  if (!item) return item;
  const inst = { ...(item.institutionalInfo || {}) };
  const resp = { ...(item.responsable || {}) };

  // Always update institutional data to official government values
  inst.dependencia = inst.dependencia || OFFICIAL_INSTITUTIONAL_DATA.dependencia;
  inst.direccionUnidad = OFFICIAL_INSTITUTIONAL_DATA.direccionUnidad;
  inst.domicilio = OFFICIAL_INSTITUTIONAL_DATA.domicilio;
  inst.telefono = OFFICIAL_INSTITUTIONAL_DATA.telefono;
  inst.paginaWeb = OFFICIAL_INSTITUTIONAL_DATA.paginaWeb;

  // Always update officer name, cargo and department if default or unset
  if (!resp.nombreCompleto || resp.nombreCompleto.includes('Carlos Alberto Morales') || resp.nombreCompleto === 'Pablo Ernesto Garrido Vera') {
    resp.nombreCompleto = OFFICIAL_INSTITUTIONAL_DATA.nombreCompleto;
  }
  if (!resp.cargo || resp.cargo.includes('Jefe del Departamento') || resp.cargo === 'Encargado Balizamiento y Semaforizacion') {
    resp.cargo = OFFICIAL_INSTITUTIONAL_DATA.cargo;
  }
  if (!resp.areaAdministrativa || resp.areaAdministrativa.includes('Movilidad Urbana') || resp.areaAdministrativa === 'Dirección de Transito y Vialidad') {
    resp.areaAdministrativa = OFFICIAL_INSTITUTIONAL_DATA.areaAdministrativa;
  }

  return {
    ...item,
    institutionalInfo: inst as any,
    responsable: resp as any,
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB no soportado'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const StorageService = {
  async getAll(): Promise<InspectionData[]> {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          let items: InspectionData[] = req.result || [];
          if (items.length === 0) {
            // Seed with sample inspection
            const seeded = enforceOfficialInstitutionalData(SAMPLE_INSPECTION_DATA);
            this.save(seeded).then(() => {
              resolve([seeded]);
            });
            return;
          }

          // Always enforce official defaults on every load
          items = items.map(item => enforceOfficialInstitutionalData(item));

          // Sort by updatedAt descending
          items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          resolve(items);
        };
        req.onerror = () => {
          resolve(this.getFromLocalStorage());
        };
      });
    } catch {
      return this.getFromLocalStorage();
    }
  },

  async getById(id: string): Promise<InspectionData | null> {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => {
          const item = req.result ? enforceOfficialInstitutionalData(req.result) : null;
          resolve(item);
        };
        req.onerror = () => resolve(this.getByIdFromLocalStorage(id));
      });
    } catch {
      return this.getByIdFromLocalStorage(id);
    }
  },

  async save(data: InspectionData): Promise<void> {
    const updatedData: InspectionData = enforceOfficialInstitutionalData({
      ...data,
      updatedAt: new Date().toISOString(),
    });
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(updatedData);
        req.onsuccess = () => {
          this.syncBackupToLocalStorage(updatedData);
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('Fallback a localStorage:', err);
      this.saveToLocalStorage(updatedData);
    }
  },

  async delete(id: string): Promise<void> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => {
          this.deleteFromLocalStorage(id);
          resolve();
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      this.deleteFromLocalStorage(id);
    }
  },

  // Fallbacks & local storage sync for resilience
  getFromLocalStorage(): InspectionData[] {
    try {
      const raw = localStorage.getItem(LS_FALLBACK_KEY);
      if (raw) {
        const parsed: InspectionData[] = JSON.parse(raw);
        return parsed.map(item => enforceOfficialInstitutionalData(item));
      }
      return [enforceOfficialInstitutionalData(SAMPLE_INSPECTION_DATA)];
    } catch {
      return [enforceOfficialInstitutionalData(SAMPLE_INSPECTION_DATA)];
    }
  },

  getByIdFromLocalStorage(id: string): InspectionData | null {
    const items = this.getFromLocalStorage();
    const found = items.find(i => i.id === id);
    return found ? enforceOfficialInstitutionalData(found) : null;
  },

  saveToLocalStorage(data: InspectionData) {
    try {
      const items = this.getFromLocalStorage();
      const cleanData = enforceOfficialInstitutionalData(data);
      const idx = items.findIndex(i => i.id === cleanData.id);
      if (idx >= 0) items[idx] = cleanData;
      else items.unshift(cleanData);
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(items));
    } catch (e) {
      console.warn('LocalStorage limit reached', e);
    }
  },

  deleteFromLocalStorage(id: string) {
    try {
      const items = this.getFromLocalStorage().filter(i => i.id !== id);
      localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(items));
    } catch (e) {
      console.warn('LocalStorage delete error', e);
    }
  },

  syncBackupToLocalStorage(data: InspectionData) {
    try {
      const copy = { ...data };
      this.saveToLocalStorage(copy);
    } catch {
      // Ignored if full
    }
  },

  exportToJson(data: InspectionData): void {
    const jsonStr = JSON.stringify(enforceOfficialInstitutionalData(data), null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Respaldo_${data.folioInterno || data.id || 'inspeccion'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  },

  async importFromJson(file: File): Promise<InspectionData> {
    const text = await file.text();
    const data: InspectionData = JSON.parse(text);
    if (!data.id) {
      data.id = 'insp-' + Date.now();
    }
    data.updatedAt = new Date().toISOString();
    const cleanData = enforceOfficialInstitutionalData(data);
    await this.save(cleanData);
    return cleanData;
  }
};
