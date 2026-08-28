{
  "name": "openkcm-ui",
  "luigiConfigFragment": {
    "data": {
      "nodes": [
        {
          "pathSegment": "openkcm",
          "navigationContext": "openkcm-account",
          "label": "Root Keys",
          "entityType": "main.core_platform-mesh_io_account",
          "icon": "shield",
          "order": __ACCOUNT_NAV_ORDER__,
          "category": {
            "id": "openkcm",
            "isGroup": true,
            "icon": "shield",
            "label": "OpenKCM",
            "collapsible": true,
            "order": __ACCOUNT_NAV_ORDER__
          },
          "keepSelectedForChildren": true,
          "loadingIndicator": { "enabled": false },
          "context": {
            "openkcmLevel": "account",
            "accountNamespace": "__ACCOUNT_NAMESPACE__"
          },
          "url": "__HOST__/index.html"
        }
      ]
    }
  }
}
