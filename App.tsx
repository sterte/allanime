import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReaderScreen from './src/screens/ReaderScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <ReaderScreen />
    </SafeAreaProvider>
  );
}
