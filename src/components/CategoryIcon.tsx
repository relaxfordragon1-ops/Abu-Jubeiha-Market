import {
  Smartphone,
  KeyRound,
  Building2,
  MapPin,
  Car,
  Sofa,
  Sprout,
  Wrench,
  LayoutGrid,
  SearchCheck,
  Briefcase,
  Megaphone,
  Package,
} from 'lucide-react';

export function CategoryIcon({
  name,
  className = 'w-5 h-5',
}: {
  name?: string;
  className?: string;
}) {
  switch (name) {
    case 'Smartphone':
      return <Smartphone className={className} />;
    case 'KeyRound':
      return <KeyRound className={className} />;
    case 'Building2':
      return <Building2 className={className} />;
    case 'MapPin':
      return <MapPin className={className} />;
    case 'Car':
      return <Car className={className} />;
    case 'Sofa':
      return <Sofa className={className} />;
    case 'Sprout':
      return <Sprout className={className} />;
    case 'Wrench':
      return <Wrench className={className} />;
    case 'LayoutGrid':
      return <LayoutGrid className={className} />;
    case 'SearchCheck':
      return <SearchCheck className={className} />;
    case 'Briefcase':
      return <Briefcase className={className} />;
    case 'Megaphone':
      return <Megaphone className={className} />;
    default:
      return <Package className={className} />;
  }
}
