import mascotUrl from '../assets/whale-buddy-mascot.png';
import { useAppStore } from '../state/store';

export function BrandMark({ size = 36 }: { size?: number }) {
  const configuredIconUrl = useAppStore((state) => state.branding.iconUrl);
  return (
    <img
      aria-hidden="true"
      className="brand-mark"
      src={configuredIconUrl ?? mascotUrl}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}
