export type Route = "chat" | "settings";

export function getRoute(): Route {
  return location.hash === "#settings" ? "settings" : "chat";
}

export function navigate(route: Route): void {
  location.hash = route === "settings" ? "settings" : "";
}
