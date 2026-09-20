import { render } from '@testing-library/react-native';
import App from './App';

test('App renders without crashing', () => {
  const { toJSON } = render(<App />);
  expect(toJSON()).not.toBeNull();
});
