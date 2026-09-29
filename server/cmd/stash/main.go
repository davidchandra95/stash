package main

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"stash/server/internal/syncserver"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("stash stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	db, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer db.Close()
	s := &syncserver.Server{DB: db}
	if err = s.Migrate(ctx); err != nil {
		return err
	}
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "create-device":
			if len(os.Args) != 3 {
				return fmt.Errorf("usage: stash create-device NAME")
			}
			id, token, e := s.CreateDevice(ctx, os.Args[2])
			if e != nil {
				return e
			}
			fmt.Printf("%s\n%s\n", id, token)
			return nil
		case "revoke-device":
			if len(os.Args) != 3 {
				return fmt.Errorf("usage: stash revoke-device ID")
			}
			tag, e := db.Exec(ctx, "UPDATE devices SET revoked=true WHERE id=$1", os.Args[2])
			if e != nil {
				return e
			}
			if tag.RowsAffected() != 1 {
				return fmt.Errorf("unknown device")
			}
			return nil
		default:
			return fmt.Errorf("unknown command")
		}
	}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	srv := &http.Server{Addr: addr, Handler: s.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 90 * time.Second, WriteTimeout: 90 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	done := make(chan error, 1)
	go func() { done <- srv.ListenAndServe() }()
	select {
	case err = <-done:
		return err
	case <-ctx.Done():
		shutdown, stop := context.WithTimeout(context.Background(), 15*time.Second)
		defer stop()
		return srv.Shutdown(shutdown)
	}
}
