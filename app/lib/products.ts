export type Product = {
  id: string;
  slug?: string;
  name: string;
  price: string;
  unitPrice: number;
  oldPrice: string;
  badge: string;
  image: string;
  category: string;
  brand: string;
  shortDescription: string;
  discount: number;
  rating: number;
  reviewCount: number;
  sellerName?: string;
  storeSlug?: string;
  images?: string[];
  stock?: number;
  technicalDetails?: string;
  shippingInfo?: string;
};

export type Category = {
  name: string;
  slug: string;
  icon: string;
};

export const categories: Category[] = [
  { name: "Olta Kamışları", slug: "olta-kamislari", icon: "🎣" },
  { name: "Olta Makineleri", slug: "olta-makineleri", icon: "⚙️" },
  { name: "Misina", slug: "misina", icon: "🧵" },
  { name: "İğne", slug: "igne", icon: "🪝" },
  { name: "Yem ve Sahte", slug: "yem-ve-sahte", icon: "🐟" },
  { name: "Çanta ve Ekipman", slug: "canta-ve-ekipman", icon: "🎒" },
];

export const products: Product[] = [
  {
    id: "spin-olta-seti",
    name: "Spin Olta Seti",
    price: "1.499 TL",
    unitPrice: 1499,
    oldPrice: "1.799 TL",
    badge: "Çok Satan",
    image: "/products/spin-olta-seti.jpg",
    category: "Olta Kamışları",
    brand: "BalıkGo",
    shortDescription: "Kıyıdan spin avcılığı için kamış, makine ve temel aksesuarları bir araya getiren dengeli set.",
    discount: 17,
    rating: 4.8,
    reviewCount: 126,
  },
  {
    id: "olta-makinesi-3000",
    name: "3000'lik Olta Makinesi",
    price: "899 TL",
    unitPrice: 899,
    oldPrice: "1.099 TL",
    badge: "İndirim",
    image: "/products/olta-makinesi.jpg",
    category: "Olta Makineleri",
    brand: "Avenger",
    shortDescription: "Akıcı sarım ve güçlü çekiş sunan, kıyı avlarına uygun 3000'lik olta makinesi.",
    discount: 18,
    rating: 4.7,
    reviewCount: 98,
  },
  {
    id: "premium-misina-028",
    name: "Premium Misina 0.28mm",
    price: "349 TL",
    unitPrice: 349,
    oldPrice: "429 TL",
    badge: "Yeni",
    image: "/products/premium-misina.jpg",
    category: "Misina",
    brand: "Premium",
    shortDescription: "0.28 mm kalınlığında, yüksek performanslı ve dayanıklı örgü misina.",
    discount: 19,
    rating: 4.9,
    reviewCount: 143,
  },
  {
    id: "levrek-sahte-yem-seti",
    name: "Levrek Sahte Yem Seti",
    price: "599 TL",
    unitPrice: 599,
    oldPrice: "699 TL",
    badge: "Popüler",
    image: "/products/levrek-sahte-yem.jpg",
    category: "Yem ve Sahte",
    brand: "BalıkGo",
    shortDescription: "Levrek avı için seçilmiş, farklı renk ve aksiyonlara sahip sahte yem seti.",
    discount: 14,
    rating: 4.6,
    reviewCount: 77,
  },
];

export const spinOltaSeti = products[0];

export function formatPrice(price: number) {
  return `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price)} TL`;
}

function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function searchProducts(query: string) {
  const normalizedQuery = normalizeSearchText(query.trim());
  if (!normalizedQuery) return [];

  return products.filter((product) =>
    [product.name, product.brand, product.category, product.shortDescription]
      .some((value) => normalizeSearchText(value).includes(normalizedQuery)),
  );
}

export function getProductById(productId: string | null) {
  return products.find((product) => product.id === productId);
}

export function getCategoryBySlug(slug: string) {
  return categories.find((category) => category.slug === slug);
}
