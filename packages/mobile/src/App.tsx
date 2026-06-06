// Root component (spec §1.3). Renders from local state on launch, then reconciles
// in the background — the user never stares at a spinner because a tower dropped.
import type { ReactElement } from "react";
import { Provider } from "react-redux";
import { store } from "./store/store";
import { RootNavigator } from "./navigation/RootNavigator";

export function App(): ReactElement {
  return (
    <Provider store={store}>
      <RootNavigator initial={{ name: "Login" }} />
    </Provider>
  );
}
