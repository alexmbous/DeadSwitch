import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/ui';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={styles.tabIconWrap}>
      <View
        style={[
          styles.tabBullet,
          { backgroundColor: focused ? colors.text : colors.textFaint },
        ]}
      />
      <Text
        style={[
          typography.label,
          styles.tabLabel,
          { color: focused ? colors.text : colors.textDim },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 64,
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Status" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="scenarios/index"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Scenarios" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="scenarios/new"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="scenarios/[id]/index"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="scenarios/[id]/preview"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="contacts/index"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Contacts" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings/index"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="Settings" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabIconWrap: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  tabBullet: { width: 6, height: 6, borderRadius: 3 },
  tabLabel: { fontSize: 10, letterSpacing: 1.4 },
});
