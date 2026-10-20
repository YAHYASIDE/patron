import type { Dict } from '.';

const dict: Dict = {
  fr: {
    // an Arabic word is a valid identifier, so short keys may be unquoted
    حذف: 'Supprimer',
    'مرحبًا {name}': 'Bonjour {name}',
    'نص طويل ' + 'مقسوم': 'Texte long',
  },
  en: {
    حذف: 'Remove',
    'مرحبًا {name}': 'Hello {name}',
    "نص طويل مقسوم": 'Long text',
  },
};

export default dict;
