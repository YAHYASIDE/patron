import type { Dict } from '.';

/**
 * Platform V2 texts for this area (Arabic keys as written in the code):
 * search (clear, result count, empty state), section tabs, the orders list.
 */
const dict: Dict = {
  fr: {
    // search: SearchSuggest, products page, BrandGrid
    'مسح البحث': 'Effacer la recherche',
    'النتائج: {n}': 'Résultats : {n}',
    'لا نتائج لـ «{search}»': 'Aucun résultat pour « {search} »',
    'تأكد من الكتابة أو جرّب اسمًا أقصر، بالعربية أو الإنجليزية.':
      "Vérifiez l'orthographe ou essayez un nom plus court, en arabe ou en anglais.",
    'كل الأقسام': 'Toutes les catégories',
    'الأقسام': 'Catégories',

    // orders list
    '+{n} أخرى': '+{n} autres',
  },
  en: {
    'مسح البحث': 'Clear search',
    'النتائج: {n}': 'Results: {n}',
    'لا نتائج لـ «{search}»': 'No results for “{search}”',
    'تأكد من الكتابة أو جرّب اسمًا أقصر، بالعربية أو الإنجليزية.':
      'Check the spelling or try a shorter name, in Arabic or English.',
    'كل الأقسام': 'All categories',
    'الأقسام': 'Categories',

    '+{n} أخرى': '+{n} more',
  },
};
export default dict;
