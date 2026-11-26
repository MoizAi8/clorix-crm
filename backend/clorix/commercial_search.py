from typing import Annotated, Literal

from pydantic import StringConstraints

from clorix.inputs import Input

QUERIES = {
    "commercial": """
      SELECT id,kind AS entity,subject AS label,
        (CASE WHEN kind='quotation' THEN 'Q-' ELSE 'INV-' END) ||
          lpad(serial::text,greatest(length(serial::text),5),'0') AS qualifier
      FROM billing_documents WHERE workspace_id=%(workspace)s
      UNION ALL
      SELECT id,'catalog',name,sku FROM catalog_items
      WHERE workspace_id=%(workspace)s AND active
    """,
    "support": """
      SELECT id,'support' AS entity,subject AS label,
        'T-' || lpad(serial::text,greatest(length(serial::text),5),'0') AS qualifier
      FROM support_tickets WHERE workspace_id=%(workspace)s
    """,
}


class SearchSpec(Input):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
    category: Literal["all", "commercial", "support"] = "all"


def search(conn, tenant, spec):
    patterns = QUERIES.values() if spec.category == "all" else (QUERIES[spec.category],)
    literal = spec.query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    # The only interpolated SQL is assembled from fixed category statements above.
    query = (
        """
      WITH records AS ("""
        + " UNION ALL ".join(patterns)
        + """)
      SELECT id,entity,label,qualifier FROM records
      WHERE label ILIKE %(contains)s OR qualifier ILIKE %(contains)s
      ORDER BY CASE WHEN lower(label)=lower(%(exact)s) OR lower(qualifier)=lower(%(exact)s) THEN 0
        WHEN label ILIKE %(prefix)s OR qualifier ILIKE %(prefix)s THEN 1 ELSE 2 END,
        lower(label),id LIMIT 18
    """
    )
    return conn.execute(
        query,
        {
            "workspace": tenant.id,
            "contains": "%" + literal + "%",
            "exact": spec.query,
            "prefix": literal + "%",
        },
    ).fetchall()
