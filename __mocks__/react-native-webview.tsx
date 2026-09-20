import React from 'react';
import { View } from 'react-native';

const WebView = React.forwardRef<View, any>((props, ref) => (
  <View ref={ref} testID="mock-webview" {...props} />
));

export default WebView;
