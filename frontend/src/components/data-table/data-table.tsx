// shadcn/ui data table (Base UI, TanStack Table v9) with sorting, filtering
// and pagination — https://ui.shadcn.com/docs/components/base/data-table
// Pagination uses the shadcn Pagination component.
import * as React from "react"
import {
  useTable,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type RowData,
  type SortingState,
} from "@tanstack/react-table"
import { useTranslation } from "react-i18next"

import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { features, type DataTableFeatures } from "./data-table-features"

interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<DataTableFeatures, TData>[]
  data: TData[]
  /** Column id the search input filters. Omit to hide the input. */
  filterColumn?: string
  filterPlaceholder?: string
  /**
   * Rows per page. A number fixes it; "auto" fits as many rows as the
   * available height allows (the table never scrolls — the rest is paged).
   * Omit to show every row without pagination.
   */
  pageSize?: number | "auto"
  /** Extra controls rendered at the end of the toolbar. */
  toolbar?: React.ReactNode
  /** Highlights a row (e.g. the consultation in session). */
  isRowHighlighted?: (row: TData) => boolean
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  filterColumn,
  filterPlaceholder,
  pageSize,
  toolbar,
  isRowHighlighted,
}: DataTableProps<TData>) {
  const { t } = useTranslation()
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const auto = pageSize === "auto"
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: typeof pageSize === "number" ? pageSize : auto ? 5 : Math.max(data.length, 1),
  })
  const fitRef = React.useRef<HTMLDivElement>(null)

  const table = useTable({
    features,
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    state: {
      sorting,
      columnFilters,
      pagination,
    },
  })

  const pageCount = table.getPageCount()
  const total = table.getFilteredRowModel().rows.length

  // "auto": measure the space the table may occupy and fit whole rows into it.
  React.useLayoutEffect(() => {
    if (!auto || !fitRef.current) return
    const el = fitRef.current
    const fit = () => {
      const head = el.querySelector("thead")?.getBoundingClientRect().height ?? 40
      const row = el.querySelector("tbody tr")?.getBoundingClientRect().height || 48
      const rows = Math.max(3, Math.floor((el.clientHeight - head - 2) / row))
      setPagination((p) => {
        if (p.pageSize === rows) return p
        const lastPage = Math.max(0, Math.ceil(total / rows) - 1)
        return { pageSize: rows, pageIndex: Math.min(p.pageIndex, lastPage) }
      })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [auto, total])
  const from = total === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1
  const to = Math.min(total, (pagination.pageIndex + 1) * pagination.pageSize)

  return (
    <div className={auto ? "flex min-h-0 flex-1 flex-col gap-3" : "flex flex-col gap-3"}>
      {(filterColumn || toolbar) && (
        <div className="flex items-center gap-2">
          {filterColumn && (
            <Input
              type="search"
              placeholder={filterPlaceholder}
              value={(table.getColumn(filterColumn)?.getFilterValue() as string) ?? ""}
              onChange={(event) => table.getColumn(filterColumn)?.setFilterValue(event.target.value)}
              className="max-w-sm"
            />
          )}
          {toolbar}
        </div>
      )}

      {/* In "auto" mode this wrapper takes the leftover height and is measured. */}
      <div ref={fitRef} className={auto ? "min-h-0 flex-1 overflow-hidden" : undefined}>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={isRowHighlighted?.(row.original) ? "selected" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {t("table.noResults")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      </div>

      {pageSize !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t("table.showing", { from, to, total })}</p>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  text={t("table.previous")}
                  aria-disabled={!table.getCanPreviousPage()}
                  className={!table.getCanPreviousPage() ? "pointer-events-none opacity-50" : undefined}
                  onClick={(e) => {
                    e.preventDefault()
                    table.previousPage()
                  }}
                />
              </PaginationItem>
              {Array.from({ length: pageCount }, (_, i) => (
                <PaginationItem key={i}>
                  <PaginationLink
                    href="#"
                    isActive={i === pagination.pageIndex}
                    onClick={(e) => {
                      e.preventDefault()
                      table.setPageIndex(i)
                    }}
                  >
                    {i + 1}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  text={t("table.next")}
                  aria-disabled={!table.getCanNextPage()}
                  className={!table.getCanNextPage() ? "pointer-events-none opacity-50" : undefined}
                  onClick={(e) => {
                    e.preventDefault()
                    table.nextPage()
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  )
}
