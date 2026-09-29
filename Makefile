.PHONY: debug release

debug:
	npm run tauri -- build --debug --bundles app

release:
	npm run tauri -- build --bundles app --config '{"bundle":{"active":true}}'
