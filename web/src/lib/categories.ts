/*
  Liste des catégories de dépense, dans l'ordre d'affichage imposé par l'API et
  par la maquette : Transport, Repas, Hébergement, Carburant, Péage/Parking,
  Fournitures, Autre. Icônes lucide identiques à celles de `CarteDepense`.
*/

import {
  Bed,
  Fuel,
  Receipt,
  ShoppingBag,
  SquareParking,
  Train,
  Utensils,
  type LucideIcon,
} from "lucide-react";

import type { Categorie } from "../api/client";

export interface CategorieOption {
  valeur: Categorie;
  libelle: string;
  icone: LucideIcon;
}

export const CATEGORIES: CategorieOption[] = [
  { valeur: "transport", libelle: "Transport", icone: Train },
  { valeur: "repas", libelle: "Repas", icone: Utensils },
  { valeur: "hebergement", libelle: "Hébergement", icone: Bed },
  { valeur: "carburant", libelle: "Carburant", icone: Fuel },
  { valeur: "peage_parking", libelle: "Péage/Parking", icone: SquareParking },
  { valeur: "fournitures", libelle: "Fournitures", icone: ShoppingBag },
  { valeur: "autre", libelle: "Autre", icone: Receipt },
];
