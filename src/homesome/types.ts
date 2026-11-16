export interface StoreRef {
  /** Short name used in tool inputs, e.g. "west". */
  key: string;
  name: string;
  address: string;
  locationId: string;
  pricelistId: string;
}

/** The subset of catalog fields the server needs. */
export interface Product {
  id: string;
  name: string;
  category: string;
  subType: string;
  price: number;
  unit: string;
  unitIncrement: number | null;
  sellByQty: boolean;
  avgWeight: number | null;
  organic: boolean;
  inStock: boolean;
  minQuantity: number;
  maxQuantity: number;
  brand: string;
  upc: string;
}

export interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  sellByQty: boolean;
  price: number;
  estimatedPrice: number;
  organic: boolean;
  inStock: boolean;
  instructions: string;
}

export interface Cart {
  store: string;
  items: CartItem[];
  unavailable: string[];
  subtotal: number;
  tax: number;
  total: number;
}

export type ProducePreference = "conventional" | "organic";
