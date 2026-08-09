import React from 'react';
import QRCode from 'react-native-qrcode-svg';

export default function PixQrCode({
  value,
  size,
  color,
  backgroundColor,
}: {
  value: string;
  size: number;
  color: string;
  backgroundColor: string;
}) {
  return (
    <QRCode
      value={value}
      size={size}
      color={color}
      backgroundColor={backgroundColor}
    />
  );
}
