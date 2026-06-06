import Link from 'next/link';
import SearchForm from './SearchForm';

export default function Header() {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <Link href="/" className="text-xl font-black text-primary whitespace-nowrap tracking-tight">
          推しサーチ
        </Link>
        <div className="flex-1 max-w-lg">
          <SearchForm compact />
        </div>
      </div>
    </header>
  );
}
