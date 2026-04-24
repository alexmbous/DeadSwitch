import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { getAccessToken } from '@/auth/session';
import { useState } from 'react';

export default function Index() {
  const [checked, setChecked] = useState<null | boolean>(null);
  useEffect(() => {
    getAccessToken().then((t) => setChecked(Boolean(t)));
  }, []);
  if (checked === null) return null;
  return checked ? <Redirect href="/(app)" /> : <Redirect href="/(auth)/login" />;
}
