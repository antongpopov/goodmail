import { avatarColor, initials } from './util.ts';

export function Avatar({ addr, size = 32 }: { addr: { name: string; address: string }; size?: number }) {
  return (
    <span className="avatar" style={{ background: avatarColor(addr.address || addr.name), width: size, height: size, fontSize: size * 0.4 }}>
      {initials(addr)}
    </span>
  );
}
